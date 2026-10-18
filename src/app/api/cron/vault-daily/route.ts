import type { NextRequest } from "next/server";
import { VAULT_SCHEDULE_ID } from "@/lib/pipeline-schedule";
import { handleDailyCron } from "@/lib/outreach/daily-cron";
import { runDailyColdOutreach } from "@/lib/vault-daily-run";

// The Cold Outreach runs (vercel.json: "2 16-23 * * 1-5", hourly from 9:02 AM Arizona
// time, Monday to Friday). Auth, the on/off switch, recording and errors: handleDailyCron.
export const maxDuration = 60;

export function GET(request: NextRequest) {
  return handleDailyCron(request, {
    pipeline: "cold-outreach",
    scheduleId: VAULT_SCHEDULE_ID,
    logScope: "api.cron.vault-daily",
    run: (emailsPerDay) => runDailyColdOutreach(emailsPerDay),
  });
}
