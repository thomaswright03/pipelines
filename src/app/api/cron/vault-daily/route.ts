import type { NextRequest } from "next/server";
import { VAULT_SCHEDULE_ID } from "@/lib/pipeline-schedule";
import { handleDailyCron } from "@/lib/outreach/daily-cron";
import { runDailyColdOutreach } from "@/lib/vault-daily-run";

// The Cold Outreach run (vercel.json: "2 16 * * 1-5", 9:02 AM Arizona time,
// Monday to Friday). It sends the whole day's number in one run, so it gets
// Hobby's 300 s limit under Fluid compute (vercel.json "fluid": true).
// Auth, the on/off switch, recording and errors: handleDailyCron.
export const maxDuration = 300;

export function GET(request: NextRequest) {
  return handleDailyCron(request, {
    pipeline: "cold-outreach",
    scheduleId: VAULT_SCHEDULE_ID,
    logScope: "api.cron.vault-daily",
    run: (emailsPerDay) => runDailyColdOutreach(emailsPerDay),
  });
}
