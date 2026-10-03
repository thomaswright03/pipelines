import type { NextRequest } from "next/server";
import { GARBAGE_AI_SCHEDULE_ID } from "@/lib/pipeline-schedule";
import { handleDailyCron } from "@/lib/outreach/daily-cron";
import { runDailyGarbageAi } from "@/lib/garbage-ai-daily-run";

// The daily Garbage AI run (vercel.json: "0 15 * * *", 8:00 AM Arizona
// time, before the other two daily runs): the shared daily run, so it is
// skipped outright while outbound email is paused, and while sending is
// held in code (garbage-ai-config.ts) it only finds haulers. Auth, the
// on/off switch, recording and errors: handleDailyCron.
export const maxDuration = 60;

export function GET(request: NextRequest) {
  return handleDailyCron(request, {
    pipeline: "garbage-ai",
    scheduleId: GARBAGE_AI_SCHEDULE_ID,
    logScope: "api.cron.garbage-ai-daily",
    run: (haulersPerRun) => runDailyGarbageAi(haulersPerRun),
  });
}
