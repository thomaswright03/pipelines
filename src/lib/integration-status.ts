// Settings → Connections: whether each outside service the pipelines
// depend on is working, in one place. A broken integration otherwise looks
// exactly like "nobody replied" or "nothing to send" — that is how reply
// tracking once stayed broken unnoticed.
//
// "Working" is only claimed from evidence: a successful send, test or
// search, or a reply that actually arrived. A setting merely being present
// is "Not confirmed yet". Every summary and next step is written for the
// operator, not the developer: it says what is true, what to do, and what
// to tell the developer when that's who has to act. (The settings behind
// each message are listed in docs/deployment.md → "Settings → Connections".)
import { prisma } from "@/lib/db";
import { describeMailDestination, type Env } from "@/lib/mail-transport-kind";
import { ENV_OFF_DETAIL, ENV_OFF_SUMMARY } from "@/lib/outbound-switch";
import { formatDateTime } from "@/lib/time";
import { getAppSettings, lastSendFailure, lastServiceChecks } from "@/lib/outreach/settings";
import { getReplyHealth, REPLY_WATCH_WINDOW_DAYS, replyIsRecent } from "@/lib/outreach/reply-health";
import { displayRunStatus, isRunOverdue } from "@/lib/outreach/runs";
import { getPipelineSchedule } from "@/lib/pipeline-schedule";
import {
  DATALEADSELL_DAILY_RUN_TIME_LABEL,
  DATALEADSELL_SCHEDULE_ID,
  GARBAGE_AI_DAILY_RUN_TIME_LABEL,
  GARBAGE_AI_SCHEDULE_ID,
  ROOM_DESIGNER_DAILY_RUN_TIME_LABEL,
  ROOM_DESIGNER_RUNS_WEEKDAYS_ONLY,
  ROOM_DESIGNER_SCHEDULE_ID,
  VAULT_DAILY_RUN_TIME_LABEL,
  VAULT_RUNS_WEEKDAYS_ONLY,
  VAULT_SCHEDULE_ID,
} from "@/lib/pipeline-schedule-rules";
import { PIPELINE_BASE_PATH, PIPELINE_LABEL, type PipelineId } from "@/lib/outreach/pipeline-id";

/** "off" is a job someone switched off on purpose: neither working nor broken. */
export type StatusTone = "ok" | "warn" | "error" | "off";

/** Where the operator goes to act on a row ("Open the Garbage AI page"). */
export type StatusLink = { href: string; label: string };

export type ConnectionStatus = {
  key: "mail" | "replies" | CronJob["key"] | "yelp";
  label: string;
  tone: StatusTone;
  /** The badge's words when they differ from the tone's usual label ("Not confirmed yet"). */
  badge?: string;
  /** What is true now, in plain words. */
  summary: string;
  /** What to do about it, when something needs doing. */
  next: string | null;
  /** The page the next step happens on, when it has one. */
  link?: StatusLink;
  /** A secondary line in smaller type: specifics for whoever manages the hosting. */
  detail?: string;
  /** Whether Settings offers a "Test connection" button for this service. */
  testable?: boolean;
};

const NOT_CONFIRMED = "Not confirmed yet";

type CronJob = {
  key: "daily-run" | "dataleadsell-daily" | "garbage-ai-daily" | "room-designer-daily" | "stale-contacts" | "daily-report";
  label: string;
  /** The route Vercel calls (vercel.json "crons"); a test checks every one there has a row here. */
  path: string;
  /** How its runs are recorded in PipelineRun. */
  pipeline: PipelineId | "all";
  kind: "daily" | "stale-contacts" | "daily-report";
  /** vercel.json's UTC schedule as Arizona time (MST all year), e.g. "daily at 6:00 AM Arizona time"; a test checks the two agree. */
  schedule: string;
  /** Runs Monday to Friday only, so a weekend without runs is normal. */
  weekdaysOnly?: boolean;
  /** For a pipeline's daily run: its on/off switch (PipelineSchedule). */
  scheduleId?: string;
  /** Where the operator sees the job's runs or acts on a failure. */
  page: StatusLink;
  /** What a failed or partly failed run means and what to do, in this job's own words. */
  failedNext: string;
};

const pipelinePage = (id: PipelineId): StatusLink => ({ href: PIPELINE_BASE_PATH[id], label: `Open the ${PIPELINE_LABEL[id]} page` });
const dailyRunFailedNext = (id: PipelineId) =>
  `Open the ${PIPELINE_LABEL[id]} page: its Daily automation panel lists the run and why it failed. The next run tries again automatically.`;

export const CRON_JOBS: readonly CronJob[] = [
  {
    key: "daily-run",
    label: "Daily Cold Outreach run",
    path: "/api/cron/vault-daily",
    pipeline: "cold-outreach",
    kind: "daily",
    schedule: VAULT_DAILY_RUN_TIME_LABEL,
    weekdaysOnly: VAULT_RUNS_WEEKDAYS_ONLY,
    scheduleId: VAULT_SCHEDULE_ID,
    page: pipelinePage("cold-outreach"),
    failedNext: dailyRunFailedNext("cold-outreach"),
  },
  {
    key: "dataleadsell-daily",
    label: "Daily dataleadsell run",
    path: "/api/cron/dataleadsell-daily",
    pipeline: "dataleadsell",
    kind: "daily",
    schedule: DATALEADSELL_DAILY_RUN_TIME_LABEL,
    scheduleId: DATALEADSELL_SCHEDULE_ID,
    page: pipelinePage("dataleadsell"),
    failedNext: dailyRunFailedNext("dataleadsell"),
  },
  {
    key: "garbage-ai-daily",
    label: "Daily Garbage AI search",
    path: "/api/cron/garbage-ai-daily",
    pipeline: "garbage-ai",
    kind: "daily",
    schedule: GARBAGE_AI_DAILY_RUN_TIME_LABEL,
    scheduleId: GARBAGE_AI_SCHEDULE_ID,
    page: pipelinePage("garbage-ai"),
    failedNext: dailyRunFailedNext("garbage-ai"),
  },
  {
    key: "room-designer-daily",
    label: "Daily Room Designer 3D run",
    path: "/api/cron/room-designer-daily",
    pipeline: "room-designer",
    kind: "daily",
    schedule: ROOM_DESIGNER_DAILY_RUN_TIME_LABEL,
    weekdaysOnly: ROOM_DESIGNER_RUNS_WEEKDAYS_ONLY,
    scheduleId: ROOM_DESIGNER_SCHEDULE_ID,
    page: pipelinePage("room-designer"),
    failedNext: dailyRunFailedNext("room-designer"),
  },
  {
    key: "stale-contacts",
    label: "Move silent leads to the call deck",
    path: "/api/cron/stale-contacts",
    pipeline: "all",
    kind: "stale-contacts",
    schedule: "daily at 6:00 AM Arizona time",
    page: { href: "/", label: "Open the dashboard" },
    failedNext:
      "Leads that went a week without a reply may be missing from the call decks until the next run, which tries again automatically. Each pipeline's call deck is linked from the dashboard.",
  },
  {
    key: "daily-report",
    label: "Daily report email",
    path: "/api/cron/daily-report",
    pipeline: "all",
    kind: "daily-report",
    schedule: "daily at 10:00 AM Arizona time",
    page: { href: "#connection-mail", label: "Go to Sending email" },
    failedNext:
      "The report goes out through the same email service as the pitches: check Sending email above and press Test connection. Tomorrow's report tries again automatically.",
  },
];

type Evidence = { at: Date; ok: boolean; text: string; kind: "send" | "test" };

/** The most recent of several pieces of evidence, or null when there is none. */
function latest(evidence: (Evidence | null)[]): Evidence | null {
  return evidence.filter((e): e is Evidence => e !== null).sort((a, b) => b.at.getTime() - a.at.getTime())[0] ?? null;
}

async function mailStatus(env: Env): Promise<ConnectionStatus> {
  const destination = describeMailDestination(env);
  const [lastSent, failure, settings, checks] = await Promise.all([
    prisma.outreachRecipient.findFirst({ where: { state: "sent" }, orderBy: { sentAt: "desc" }, select: { sentAt: true } }),
    lastSendFailure(),
    getAppSettings(),
    lastServiceChecks(),
  ]);
  const sentAt = lastSent?.sentAt ?? null;
  const last = latest([
    sentAt ? { at: sentAt, ok: true, kind: "send", text: `Last email sent ${formatDateTime(sentAt)}.` } : null,
    failure
      ? {
          at: failure.at,
          ok: false,
          kind: "send",
          text: `The last send failed ${formatDateTime(failure.at)}: ${failure.message ?? "the email service refused it"}`,
        }
      : null,
    checks.mail
      ? checks.mail.error
        ? {
            at: checks.mail.at,
            ok: false,
            kind: "test",
            text: `The connection test ${formatDateTime(checks.mail.at)} failed: ${checks.mail.error}`,
          }
        : { at: checks.mail.at, ok: true, kind: "test", text: `Connection test passed ${formatDateTime(checks.mail.at)}.` }
      : null,
  ]);
  const parts = [destination.description];
  if (last) parts.push(last.text);
  if (last?.kind === "test" && sentAt) parts.push(`Last email sent ${formatDateTime(sentAt)}.`);
  const status = (tone: StatusTone, next: string | null, badge?: string): ConnectionStatus => ({
    key: "mail",
    label: "Sending email",
    tone,
    badge,
    summary: parts.join(" "),
    next,
    testable: true,
  });

  if (last && !last.ok) {
    return status(
      "error",
      "Press Test connection. If it fails again, tell your developer what it says — nothing is sent until this is fixed.",
    );
  }
  if (settings.pausedBy === "environment") {
    parts.push(ENV_OFF_SUMMARY);
    return {
      ...status("warn", `Ask whoever manages the app's hosting to turn sending back on when it should resume.`),
      detail: ENV_OFF_DETAIL,
    };
  }
  if (settings.outboundPaused) {
    parts.push("Outbound email is paused, so nothing is being sent.");
    return status("warn", "Resume sending with the switch above when you're ready.");
  }
  if (!destination.delivers) {
    return status("warn", "Fine for trying things out. For real sending, tell your developer the app is still in test mode.");
  }
  if (!last) {
    parts.push("Nothing has been sent or tested yet, so the login to the email service is unproven.");
    return status("warn", "Press Test connection — it logs in without sending anything.", NOT_CONFIRMED);
  }
  return status("ok", null);
}

async function repliesStatus(env: Env, now: Date): Promise<ConnectionStatus> {
  const health = await getReplyHealth(now);
  const received = health.lastReplyAt ? `Last reply received ${formatDateTime(health.lastReplyAt)}.` : "No reply has arrived yet.";
  const base = { key: "replies" as const, label: "Receiving replies" };
  const byHand = "Meanwhile, when someone replies, open their lead and mark the reply by hand.";
  if (!env.EMAIL_INBOUND_SECRET) {
    return {
      ...base,
      tone: "error",
      summary: `Reply forwarding isn't switched on in the app, so every reply is turned away. ${received}`,
      next: `Tell your developer the reply-forwarding secret isn't set on the server. ${byHand}`,
    };
  }
  if (health.warning) {
    return {
      ...base,
      tone: "warn",
      summary: `${received} Emails have gone out, but no reply of any kind — not even an out-of-office or a bounce — ${
        health.reason === "never"
          ? "has ever arrived"
          : health.reason === "silent_sends"
            ? `has arrived after the last ${health.sendsSinceLastReply} of them`
            : `has arrived in the last ${REPLY_WATCH_WINDOW_DAYS} days`
      }. That usually means replies (opt-outs among them) aren't reaching the app.`,
      next: `Tell your developer that replies seem to have stopped arriving, and when the last one came. ${byHand}`,
    };
  }
  if (!health.lastReplyAt) {
    return {
      ...base,
      tone: "warn",
      badge: NOT_CONFIRMED,
      summary: "No reply has arrived yet, so there's no proof that replies reach the app. The first reply that arrives confirms it.",
      next: `Until then, when someone replies, open their lead and mark the reply by hand. If a reply you received in your inbox doesn't show up here, tell your developer.`,
    };
  }
  if (!replyIsRecent(health.lastReplyAt, now)) {
    return {
      ...base,
      tone: "warn",
      badge: "Not confirmed lately",
      summary: `${received} Nothing has been sent that would get a reply since, so it isn't known whether replies still arrive.`,
      next: `If a reply you received in your inbox doesn't show up here, tell your developer. ${byHand}`,
    };
  }
  return { ...base, tone: "ok", summary: received, next: null };
}

async function cronStatus(job: CronJob, env: Env, now: Date): Promise<ConnectionStatus> {
  const [run, schedule] = await Promise.all([
    prisma.pipelineRun.findFirst({ where: { pipeline: job.pipeline, kind: job.kind }, orderBy: { startedAt: "desc" } }),
    job.scheduleId ? getPipelineSchedule(job.scheduleId) : null,
  ]);
  const base = { key: job.key, label: job.label };
  if (env.VERCEL && !env.CRON_SECRET) {
    return {
      ...base,
      tone: "error",
      summary: "The scheduled job is turned away because its password isn't set on the server.",
      next: "Tell your developer the cron secret isn't set in Vercel.",
    };
  }
  const lastRun = run ? ` Last run ${formatDateTime(run.startedAt)}: ${displayRunStatus(run, now)}.` : "";
  if (schedule && !schedule.enabled) {
    // Switched off on purpose: not a failure, and its daily "skipped" runs are expected.
    return {
      ...base,
      tone: "off",
      badge: "Off",
      summary: `Switched off, so it neither searches nor sends. It would run ${job.schedule}.${lastRun}`,
      next: `Turn it on under Daily automation on the ${PIPELINE_LABEL[job.pipeline as PipelineId]} page when it should run.`,
      link: job.page,
    };
  }
  if (!run) {
    return {
      ...base,
      tone: "warn",
      summary: `Has never run. It is scheduled ${job.schedule}.`,
      next: env.VERCEL
        ? "If it still hasn't run after that time, tell your developer the scheduled job isn't firing."
        : "Scheduled jobs only run on the live site.",
    };
  }
  const status = displayRunStatus(run, now);
  const when = `Last run ${formatDateTime(run.startedAt)}`;
  const summary = `${when}: ${status}${run.summary ? ` — ${run.summary}` : ""}`;
  if (status === "failed" || status === "interrupted") {
    return { ...base, tone: "error", summary, next: job.failedNext, link: job.page };
  }
  if (isRunOverdue(run.startedAt, now, job.weekdaysOnly)) {
    return {
      ...base,
      tone: "warn",
      summary: `${summary}. That was ${job.weekdaysOnly ? "longer ago than a weekend" : "over a day ago"}; it runs ${job.schedule}.`,
      next: "Tell your developer the scheduled job has stopped running.",
    };
  }
  if (status === "partial") return { ...base, tone: "warn", summary, next: `Part of the run failed. ${job.failedNext}`, link: job.page };
  return { ...base, tone: "ok", summary, next: null };
}

async function yelpStatus(env: Env): Promise<ConnectionStatus> {
  const base = { key: "yelp" as const, label: "Yelp search", testable: true };
  if (!env.YELP_API_KEY) {
    return {
      ...base,
      testable: false,
      tone: "error",
      summary: "Yelp isn't set up, so searches and the daily run can't find businesses.",
      next: "Tell your developer the Yelp access key is missing.",
    };
  }
  const { yelp } = await lastServiceChecks();
  if (!yelp) {
    return {
      ...base,
      tone: "warn",
      badge: NOT_CONFIRMED,
      summary: "An access key is set, but no search has run yet to prove it works.",
      next: "Press Test connection — it runs one tiny search.",
    };
  }
  if (yelp.error) {
    return {
      ...base,
      tone: "error",
      summary: `The last Yelp request ${formatDateTime(yelp.at)} failed: ${yelp.error}`,
      next: "Press Test connection. If it fails again, tell your developer what it says.",
    };
  }
  return { ...base, tone: "ok", summary: `Yelp last answered ${formatDateTime(yelp.at)}.`, next: null };
}

export async function getConnectionStatus(env: Env = process.env, now: Date = new Date()): Promise<ConnectionStatus[]> {
  const [mail, replies, ...rest] = await Promise.all([
    mailStatus(env),
    repliesStatus(env, now),
    ...CRON_JOBS.map((job) => cronStatus(job, env, now)),
    yelpStatus(env),
  ]);
  return [mail, replies, ...rest];
}
