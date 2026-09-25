// Daily-automation settings rules, shared by the settings form (checks as
// you type) and the server action (the authority). Client-safe.
import { z } from "zod";

export const VAULT_SCHEDULE_ID = "vault-pipeline";

/** The cron time in vercel.json ("33 15 * * *" UTC), as Arizona wall-clock time (MST, no DST). */
export const VAULT_DAILY_RUN_TIME_LABEL = "8:33 AM Arizona time";

export type PipelineScheduleData = { enabled: boolean; leadCount: number };

export const LEAD_COUNT_MIN = 1;
export const LEAD_COUNT_MAX = 100;

const RANGE_MESSAGE = `Leads per run must be a whole number between ${LEAD_COUNT_MIN} and ${LEAD_COUNT_MAX}`;

export const scheduleSchema = z.object({
  enabled: z.boolean(),
  leadCount: z
    .number({ error: RANGE_MESSAGE })
    .int(RANGE_MESSAGE)
    .min(LEAD_COUNT_MIN, RANGE_MESSAGE)
    .max(LEAD_COUNT_MAX, RANGE_MESSAGE),
});
