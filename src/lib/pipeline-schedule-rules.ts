// Daily-automation settings rules, shared by the settings form (checks as
// you type) and the server action (the authority). Client-safe.
import { z } from "zod";

export const VAULT_SCHEDULE_ID = "vault-pipeline";
export const DATALEADSELL_SCHEDULE_ID = "dataleadsell";

/** The cron time in vercel.json ("33 15 * * *" UTC), as Arizona wall-clock time (MST, no DST). */
export const VAULT_DAILY_RUN_TIME_LABEL = "8:33 AM Arizona time";
/** The dataleadsell cron time in vercel.json ("3 16 * * *" UTC): 30 minutes after Cold Outreach's, so the two never overlap. */
export const DATALEADSELL_DAILY_RUN_TIME_LABEL = "9:03 AM Arizona time";

/**
 * `businessesPerRun` caps how many Yelp businesses one daily run checks for
 * an email address — not how many get emailed: typically only 15–25% of
 * businesses turn up a usable address, and the run also stops looking
 * after about 25 seconds (see outreach/daily-run.ts). In the dataleadsell
 * pipeline the same number caps the agents checked. (Stored in PipelineSchedule.leadCount.)
 */
export type PipelineScheduleData = { enabled: boolean; businessesPerRun: number };

export const BUSINESSES_PER_RUN_MIN = 1;
/** One Yelp search returns at most 50 businesses, so a higher cap would do nothing. */
export const BUSINESSES_PER_RUN_MAX = 50;

export const BUSINESSES_PER_RUN_LABEL = "Businesses to check per run";
export const AGENTS_PER_RUN_LABEL = "Agents to check per run";

/** The out-of-range message, naming the setting as its form labels it. */
export function rangeMessage(label: string): string {
  return `${label} must be a whole number between ${BUSINESSES_PER_RUN_MIN} and ${BUSINESSES_PER_RUN_MAX}`;
}

export function scheduleSchemaFor(label: string) {
  const message = rangeMessage(label);
  return z.object({
    enabled: z.boolean(),
    businessesPerRun: z.number({ error: message }).int(message).min(BUSINESSES_PER_RUN_MIN, message).max(BUSINESSES_PER_RUN_MAX, message),
  });
}

export const scheduleSchema = scheduleSchemaFor(BUSINESSES_PER_RUN_LABEL);
