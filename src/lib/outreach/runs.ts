// Records automated (cron) runs in PipelineRun so every run — succeeded,
// partial, failed or skipped — leaves a visible outcome with its reasons.
import { prisma } from "@/lib/db";
import { logError, logInfo } from "@/lib/log";
import { isDatabaseUnavailable } from "@/lib/db-health";
import { YelpError } from "@/lib/yelp-discovery";

type RunStatus = "succeeded" | "partial" | "failed" | "skipped";
/** What a daily discovery-and-send run actually did, as numbers. */
type RunNumbers = { businessesChecked: number; leadsFound: number; emailsSent: number };
export type RunOutcome = { status: RunStatus; summary: string; errors?: string[]; numbers?: RunNumbers };

type RecordedRun = RunOutcome & { runId: string };

/**
 * Runs `fn` with a PipelineRun row around it. A thrown error becomes a
 * "failed" run with the cause recorded (and logged with the run id); the
 * row is finalised either way.
 */
export async function recordRun(pipeline: string, kind: string, fn: (runId: string) => Promise<RunOutcome>): Promise<RecordedRun> {
  const run = await prisma.pipelineRun.create({ data: { pipeline, kind, status: "running" } });
  let outcome: RunOutcome;
  try {
    outcome = await fn(run.id);
  } catch (err) {
    logError(`run.${kind}`, err, { pipeline, runId: run.id });
    outcome = { status: "failed", summary: "The run stopped with an error.", errors: [operatorMessage(err, run.id)] };
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

/**
 * Why a run stopped, for the run list and the cron response: an error
 * already written for the operator as-is, otherwise a plain description
 * (the technical detail is in the server log under the run id).
 */
function operatorMessage(err: unknown, runId: string): string {
  // Runs are unattended, so the Yelp wording that says what happens next.
  if (err instanceof YelpError) return `Yelp: ${err.unattended}`;
  if (isDatabaseUnavailable(err)) return "The database couldn't be reached partway through the run.";
  return `An internal error stopped the run (details in the server log under run ${runId}).`;
}

export async function recentRuns(pipeline: string, kind: string, take = 5) {
  return prisma.pipelineRun.findMany({ where: { pipeline, kind }, orderBy: { startedAt: "desc" }, take });
}

/**
 * A run still "running" this long after it started was cut off by the
 * platform's time limit (or the process died) before it could record its
 * outcome — shown as interrupted, not as running forever.
 */
const RUN_INTERRUPTED_AFTER_MS = 2 * 60 * 1000;

export function displayRunStatus(run: { status: string; startedAt: Date }, now: Date = new Date()): string {
  if (run.status === "running" && now.getTime() - run.startedAt.getTime() > RUN_INTERRUPTED_AFTER_MS) return "interrupted";
  return run.status;
}

/** A daily run that hasn't happened for this long is worth a warning. */
const STALE_RUN_HOURS = 26;

/** True when the latest run started more than a day (plus slack) ago. */
export function isRunOverdue(lastStartedAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - lastStartedAt.getTime() > STALE_RUN_HOURS * 3_600_000;
}
