import type { NextRequest } from "next/server";
import { VAULT_SCHEDULE_ID } from "@/lib/pipeline-schedule";
import { handleDailyCron } from "@/lib/outreach/daily-cron";
import { runDailyColdOutreach } from "@/lib/vault-daily-run";

// The daily Cold Outreach run (vercel.json: "33 15 * * *", 8:33 AM Arizona
// time). Auth, the on/off switch, recording and errors: handleDailyCron.
export const maxDuration = 60;

export function GET(request: NextRequest) {
  return handleDailyCron(request, {
    pipeline: "cold-outreach",
    scheduleId: VAULT_SCHEDULE_ID,
    logScope: "api.cron.vault-daily",
    run: (businessesPerRun) => runDailyColdOutreach(businessesPerRun),
  });
}
