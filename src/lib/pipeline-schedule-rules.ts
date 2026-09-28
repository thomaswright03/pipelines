// Daily-automation settings rules, shared by the settings form (checks as
// you type) and the server action (the authority). Client-safe.
import { z } from "zod";

export const VAULT_SCHEDULE_ID = "vault-pipeline";

/** The cron time in vercel.json ("33 15 * * *" UTC), as Arizona wall-clock time (MST, no DST). */
export const VAULT_DAILY_RUN_TIME_LABEL = "8:33 AM Arizona time";

export const GARBAGE_AI_SCHEDULE_ID = "garbage-ai";

/** The Garbage AI cron time in vercel.json ("0 15 * * *" UTC), as Arizona time. */
export const GARBAGE_AI_DAILY_RUN_TIME_LABEL = "8:00 AM Arizona time";

/**
 * `businessesPerRun` caps how many Yelp businesses one daily run checks for
 * an email address — not how many get emailed: typically only 15–25% of
 * businesses turn up a usable address, and the run also stops looking
 * after about 25 seconds (see vault-daily-run.ts). (Stored in PipelineSchedule.leadCount.)
 */
export type PipelineScheduleData = { enabled: boolean; businessesPerRun: number };

export const BUSINESSES_PER_RUN_MIN = 1;
/** One Yelp search returns at most 50 businesses, so a higher cap would do nothing. */
export const BUSINESSES_PER_RUN_MAX = 50;

export const BUSINESSES_PER_RUN_LABEL = "Businesses to check per run";

export const RANGE_MESSAGE = `${BUSINESSES_PER_RUN_LABEL} must be a whole number between ${BUSINESSES_PER_RUN_MIN} and ${BUSINESSES_PER_RUN_MAX}`;

export const scheduleSchema = z.object({
  enabled: z.boolean(),
  businessesPerRun: z
    .number({ error: RANGE_MESSAGE })
    .int(RANGE_MESSAGE)
    .min(BUSINESSES_PER_RUN_MIN, RANGE_MESSAGE)
    .max(BUSINESSES_PER_RUN_MAX, RANGE_MESSAGE),
});
