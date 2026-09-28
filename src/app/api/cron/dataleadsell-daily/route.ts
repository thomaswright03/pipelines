import type { NextRequest } from "next/server";
import { DATALEADSELL_SCHEDULE_ID } from "@/lib/pipeline-schedule";
import { handleDailyCron } from "@/lib/outreach/daily-cron";
import { runDailyDataleadsell } from "@/lib/dataleadsell-daily-run";

// The daily dataleadsell run (vercel.json: "3 16 * * *", 9:03 AM Arizona
// time — 30 minutes after Cold Outreach's, so the two never overlap). Off
// until turned on on the dataleadsell page. Auth, the on/off switch,
// recording and errors: handleDailyCron.
export const maxDuration = 60;

export function GET(request: NextRequest) {
  return handleDailyCron(request, {
    pipeline: "dataleadsell",
    scheduleId: DATALEADSELL_SCHEDULE_ID,
    logScope: "api.cron.dataleadsell-daily",
    run: (agentsPerRun) => runDailyDataleadsell(agentsPerRun),
  });
}
