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
// each message are listed in README → Settings → Connections.)
import { prisma } from "@/lib/db";
import { describeMailDestination, type Env } from "@/lib/mail-transport-kind";
import { formatDateTime } from "@/lib/time";
import { getAppSettings, lastSendFailure, lastServiceChecks } from "@/lib/outreach/settings";
import { getReplyHealth, REPLY_WATCH_WINDOW_DAYS, replyIsRecent } from "@/lib/outreach/reply-health";
import { displayRunStatus, isRunOverdue } from "@/lib/outreach/runs";

export type StatusTone = "ok" | "warn" | "error";

export type ConnectionStatus = {
  key: "mail" | "replies" | "daily-run" | "stale-contacts" | "yelp";
  label: string;
  tone: StatusTone;
  /** The badge's words when they differ from the tone's usual label ("Not confirmed yet"). */
  badge?: string;
  /** What is true now, in plain words. */
  summary: string;
  /** What to do about it, when something needs doing. */
  next: string | null;
  /** Whether Settings offers a "Test connection" button for this service. */
  testable?: boolean;
};

const NOT_CONFIRMED = "Not confirmed yet";

const CRON_JOBS = [
  {
    key: "daily-run" as const,
    label: "Daily Cold Outreach run",
    pipeline: "cold-outreach",
    kind: "daily",
    schedule: "8:33 AM Arizona time",
  },
  {
    key: "stale-contacts" as const,
    label: "Move silent leads to the call deck",
    pipeline: "all",
    kind: "stale-contacts",
    schedule: "6:00 AM Arizona time",
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
      summary: `${received} Emails have gone out, but no reply of any kind — not even an out-of-office or a bounce — has arrived in the last ${REPLY_WATCH_WINDOW_DAYS} days. That usually means replies aren't reaching the app.`,
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

async function cronStatus(job: (typeof CRON_JOBS)[number], env: Env, now: Date): Promise<ConnectionStatus> {
  const run = await prisma.pipelineRun.findFirst({ where: { pipeline: job.pipeline, kind: job.kind }, orderBy: { startedAt: "desc" } });
  const base = { key: job.key, label: job.label };
  if (env.VERCEL && !env.CRON_SECRET) {
    return {
      ...base,
      tone: "error",
      summary: "The scheduled job is turned away because its password isn't set on the server.",
      next: "Tell your developer the cron secret isn't set in Vercel.",
    };
  }
  if (!run) {
    return {
      ...base,
      tone: "warn",
      summary: `Has never run. It is scheduled daily at ${job.schedule}.`,
      next: env.VERCEL
        ? "If it still hasn't run after that time, tell your developer the scheduled job isn't firing."
        : "Scheduled jobs only run on the live site.",
    };
  }
  const status = displayRunStatus(run, now);
  const when = `Last run ${formatDateTime(run.startedAt)}`;
  const summary = `${when}: ${status}${run.summary ? ` — ${run.summary}` : ""}`;
  if (status === "failed" || status === "interrupted") {
    return { ...base, tone: "error", summary, next: "Open the Cold Outreach page to see why; the next run tries again automatically." };
  }
  if (isRunOverdue(run.startedAt, now)) {
    return {
      ...base,
      tone: "warn",
      summary: `${summary}. That was over a day ago.`,
      next: "Tell your developer the scheduled job has stopped running.",
    };
  }
  if (status === "partial")
    return { ...base, tone: "warn", summary, next: "Part of the run failed; see the run on the Cold Outreach page for why." };
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
