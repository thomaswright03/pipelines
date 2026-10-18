// Daily-automation settings rules, shared by the settings form (checks as
// you type) and the server action (the authority). Client-safe.
import { z } from "zod";

/**
 * How many times a day dataleadsell and Garbage AI run, an hour apart from
 * their first time (vercel.json has one cron entry per run: Vercel Hobby
 * crons run at most once a day each). Cold Outreach runs once.
 */
export const DAILY_RUNS = 8;

/**
 * "every hour from 8:33 AM to 3:33 PM Arizona time" for a first run at 8:33
 * AM, with ", Monday to Friday" for a pipeline that runs on weekdays only.
 */
export function runTimesLabel(firstHour: number, minute: number, weekdaysOnly = false): string {
  const at = (hour: number) => `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
  return `every hour from ${at(firstHour)} to ${at(firstHour + DAILY_RUNS - 1)} Arizona time${weekdaysOnly ? ", Monday to Friday" : ""}`;
}

/** "daily at 9:02 AM Arizona time", with ", Monday to Friday" for a pipeline that runs on weekdays only. */
export function dailyAtLabel(hour: number, minute: number, weekdaysOnly = false): string {
  const at = `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
  return `daily at ${at} Arizona time${weekdaysOnly ? ", Monday to Friday" : ""}`;
}

export const VAULT_SCHEDULE_ID = "vault-pipeline";
export const DATALEADSELL_SCHEDULE_ID = "dataleadsell";

/** Cold Outreach runs once a day, Monday to Friday only (vercel.json: "2 16 * * 1-5" UTC), and sends the whole day's number in that run. */
export const VAULT_RUNS_WEEKDAYS_ONLY = true;
/** The cron time in vercel.json, as Arizona wall-clock time (MST, no DST). */
export const VAULT_DAILY_RUN_TIME_LABEL = dailyAtLabel(9, 2, VAULT_RUNS_WEEKDAYS_ONLY);
/** The dataleadsell cron times in vercel.json ("3 16 * * *" UTC and hourly after): 30 minutes after Cold Outreach's. */
export const DATALEADSELL_DAILY_RUN_TIME_LABEL = runTimesLabel(9, 3);

export const GARBAGE_AI_SCHEDULE_ID = "garbage-ai";

/** The Garbage AI cron times in vercel.json ("0 15 * * *" UTC and hourly after), as Arizona time. */
export const GARBAGE_AI_DAILY_RUN_TIME_LABEL = runTimesLabel(8, 0);

/**
 * `emailsPerDay` is how many first pitches a pipeline sends a day (its
 * daily runs plus anything sent by hand that day). Cold Outreach runs once
 * a day with up to 300 seconds, enough for the whole number; the others run
 * several times a day (DAILY_RUNS) and each run searches and sends only what
 * the day still needs, stopping once the number is reached (a 60-second run
 * fits about 10 sends). (Stored in PipelineSchedule.leadCount.)
 */
export type PipelineScheduleData = { enabled: boolean; emailsPerDay: number };

export const EMAILS_PER_DAY_MIN = 1;
export const EMAILS_PER_DAY_MAX = 50;

export const EMAILS_PER_DAY_LABEL = "Emails to send per day";

/** The out-of-range message, naming the setting as its form labels it. */
export function rangeMessage(label: string): string {
  return `${label} must be a whole number between ${EMAILS_PER_DAY_MIN} and ${EMAILS_PER_DAY_MAX}`;
}

export function scheduleSchemaFor(label: string) {
  const message = rangeMessage(label);
  return z.object({
    enabled: z.boolean(),
    emailsPerDay: z.number({ error: message }).int(message).min(EMAILS_PER_DAY_MIN, message).max(EMAILS_PER_DAY_MAX, message),
  });
}

export const scheduleSchema = scheduleSchemaFor(EMAILS_PER_DAY_LABEL);
