// The body of each pipeline's daily cron route (/api/cron/vault-daily,
// /api/cron/dataleadsell-daily). The fire time comes from vercel.json's
// cron schedule (Vercel Hobby can't change it without a redeploy);
// "enabled" and "businesses per run" are read live from PipelineSchedule on
// every run. Every run — including a skipped or failed one — is recorded in
// PipelineRun and shown on the pipeline's page.
import { isAuthorizedBearer } from "@/lib/auth-header";
import { logError } from "@/lib/log";
import { isDatabaseUnavailable } from "@/lib/db-health";
import { getPipelineSchedule } from "@/lib/pipeline-schedule";
import { recordRun, type RunOutcome } from "@/lib/outreach/runs";
import { PIPELINE_LABEL, type PipelineId } from "@/lib/outreach/pipeline-id";

type DailyCronJob = {
  pipeline: PipelineId;
  scheduleId: string;
  /** The server-log scope for a run that couldn't even start. */
  logScope: string;
  run: (businessesPerRun: number) => Promise<RunOutcome>;
};

export async function handleDailyCron(request: Request, job: DailyCronJob): Promise<Response> {
  if (!isAuthorizedBearer(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const schedule = await getPipelineSchedule(job.scheduleId);
    const run = await recordRun(job.pipeline, "daily", async () => {
      if (!schedule.enabled) {
        return { status: "skipped", summary: `Daily automation is turned off on the ${PIPELINE_LABEL[job.pipeline]} page.` };
      }
      return job.run(schedule.businessesPerRun);
    });
    const failed = run.status === "failed";
    return Response.json({ ok: !failed, ...run }, { status: failed ? 500 : 200 });
  } catch (err) {
    // The run couldn't even be recorded — most likely the database is
    // unreachable. The detail goes to the log, never into the response.
    const code = isDatabaseUnavailable(err) ? "db_unavailable" : "internal";
    logError(job.logScope, err, { code });
    const error =
      code === "db_unavailable"
        ? "The daily run couldn't start: the database can't be reached. It will run again at its next scheduled time."
        : "The daily run couldn't start because of an internal error. It will run again at its next scheduled time.";
    return Response.json({ ok: false, code, error }, { status: code === "db_unavailable" ? 503 : 500 });
  }
}
