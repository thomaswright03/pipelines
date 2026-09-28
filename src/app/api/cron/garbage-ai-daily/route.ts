import type { NextRequest } from "next/server";
import { isAuthorizedBearer } from "@/lib/auth-header";
import { logError } from "@/lib/log";
import { isDatabaseUnavailable } from "@/lib/db-health";
import { getPipelineSchedule, GARBAGE_AI_SCHEDULE_ID } from "@/lib/pipeline-schedule";
import { recordRun } from "@/lib/outreach/runs";
import { runDailyGarbageAi } from "@/lib/garbage-ai-daily-run";

// The daily Garbage AI search (vercel.json fixes the time; "enabled" and
// "businesses per run" are read live from PipelineSchedule). Every run is
// recorded in PipelineRun and shown on the Garbage AI page. While sending
// is held (garbage-ai-config.ts) it only finds haulers.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!isAuthorizedBearer(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const schedule = await getPipelineSchedule(GARBAGE_AI_SCHEDULE_ID);
    const run = await recordRun("garbage-ai", "daily", async () => {
      if (!schedule.enabled) {
        return { status: "skipped", summary: "Daily automation is turned off on the Garbage AI page." };
      }
      return runDailyGarbageAi(schedule.businessesPerRun);
    });
    const failed = run.status === "failed";
    return Response.json({ ok: !failed, ...run }, { status: failed ? 500 : 200 });
  } catch (err) {
    const code = isDatabaseUnavailable(err) ? "db_unavailable" : "internal";
    logError("api.cron.garbage-ai-daily", err, { code });
    const error =
      code === "db_unavailable"
        ? "The daily run couldn't start: the database can't be reached. It will run again at its next scheduled time."
        : "The daily run couldn't start because of an internal error. It will run again at its next scheduled time.";
    return Response.json({ ok: false, code, error }, { status: code === "db_unavailable" ? 503 : 500 });
  }
}
