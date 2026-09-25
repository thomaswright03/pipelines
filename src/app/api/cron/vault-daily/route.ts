import type { NextRequest } from "next/server";
import { isAuthorizedBearer } from "@/lib/auth-header";
import { logError } from "@/lib/log";
import { isDatabaseUnavailable } from "@/lib/db-health";
import { getPipelineSchedule, VAULT_SCHEDULE_ID } from "@/lib/pipeline-schedule";
import { recordRun } from "@/lib/outreach/runs";
import { runDailyColdOutreach } from "@/lib/vault-daily-run";

// The fire time comes from vercel.json's cron schedule (Vercel Hobby can't
// change it without a redeploy); "enabled" and "leads per run" are read
// live from PipelineSchedule on every run. Every run — including a skipped
// or failed one — is recorded in PipelineRun and shown on the Cold
// Outreach page.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!isAuthorizedBearer(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const schedule = await getPipelineSchedule(VAULT_SCHEDULE_ID);
    const run = await recordRun("cold-outreach", "daily", async () => {
      if (!schedule.enabled) {
        return { status: "skipped", summary: "Daily automation is turned off on the Cold Outreach page." };
      }
      return runDailyColdOutreach(schedule.businessesPerRun);
    });
    const failed = run.status === "failed";
    return Response.json({ ok: !failed, ...run }, { status: failed ? 500 : 200 });
  } catch (err) {
    // The run couldn't even be recorded — most likely the database is
    // unreachable. The detail goes to the log, never into the response.
    const code = isDatabaseUnavailable(err) ? "db_unavailable" : "internal";
    logError("api.cron.vault-daily", err, { code });
    const error =
      code === "db_unavailable"
        ? "The daily run couldn't start: the database can't be reached. It will run again at its next scheduled time."
        : "The daily run couldn't start because of an internal error. It will run again at its next scheduled time.";
    return Response.json({ ok: false, code, error }, { status: code === "db_unavailable" ? 503 : 500 });
  }
}
