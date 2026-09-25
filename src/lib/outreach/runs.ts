// Records automated (cron) runs in PipelineRun so every run — succeeded,
// partial, failed or skipped — leaves a visible outcome with its reasons.
import { prisma } from "@/lib/db";
import { describeError, logError, logInfo } from "@/lib/log";

export type RunStatus = "succeeded" | "partial" | "failed" | "skipped";
/** What a daily discovery-and-send run actually did, as numbers. */
export type RunNumbers = { businessesChecked: number; leadsFound: number; emailsSent: number };
export type RunOutcome = { status: RunStatus; summary: string; errors?: string[]; numbers?: RunNumbers };

export type RecordedRun = RunOutcome & { runId: string };

/**
 * Runs `fn` with a PipelineRun row around it. A thrown error becomes a
 * "failed" run with the cause recorded (and logged with the run id); the
 * row is finalised either way.
 */
export async function recordRun(
  pipeline: string,
  kind: string,
  fn: (runId: string) => Promise<RunOutcome>,
): Promise<RecordedRun> {
  const run = await prisma.pipelineRun.create({ data: { pipeline, kind, status: "running" } });
  let outcome: RunOutcome;
  try {
    outcome = await fn(run.id);
  } catch (err) {
    logError(`run.${kind}`, err, { pipeline, runId: run.id });
    outcome = { status: "failed", summary: "The run stopped with an error.", errors: [describeError(err)] };
  }
  try {
    await prisma.pipelineRun.update({
      where: { id: run.id },
      data: {
        status: outcome.status,
        summary: outcome.summary,
        errors: outcome.errors?.length ? outcome.errors.join("\n") : null,
        ...(outcome.numbers ?? {}),
        finishedAt: new Date(),
      },
    });
  } catch (err) {
    logError(`run.${kind}.finalise`, err, { pipeline, runId: run.id });
  }
  logInfo(`run.${kind}`, `${outcome.status}: ${outcome.summary}`, { pipeline, runId: run.id });
  return { ...outcome, runId: run.id };
}

export async function recentRuns(pipeline: string, kind: string, take = 5) {
  return prisma.pipelineRun.findMany({ where: { pipeline, kind }, orderBy: { startedAt: "desc" }, take });
}

/** A daily run that hasn't happened for this long is worth a warning. */
const STALE_RUN_HOURS = 26;

/** True when the latest run started more than a day (plus slack) ago. */
export function isRunOverdue(lastStartedAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - lastStartedAt.getTime() > STALE_RUN_HOURS * 3_600_000;
}
