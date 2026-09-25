// Settings → Connections: whether each outside service the pipelines
// depend on is working, in one place. A broken integration otherwise looks
// exactly like "nobody replied" or "nothing to send" — that is how reply
// tracking once stayed broken unnoticed.
import { prisma } from "@/lib/db";
import { describeMailDestination, type Env } from "@/lib/mail-transport-kind";
import { formatDateTime } from "@/lib/time";
import { getAppSettings, lastSendFailure } from "@/lib/outreach/settings";
import { getReplyHealth } from "@/lib/outreach/reply-health";
import { displayRunStatus, isRunOverdue } from "@/lib/outreach/runs";

export type StatusTone = "ok" | "warn" | "error";

export type ConnectionStatus = {
  key: "mail" | "replies" | "daily-run" | "stale-contacts" | "yelp";
  label: string;
  tone: StatusTone;
  /** What is true now, in plain words. */
  summary: string;
  /** What to do about it, when something needs doing. */
  next: string | null;
};

const CRON_JOBS = [
  { key: "daily-run" as const, label: "Daily Cold Outreach run", pipeline: "cold-outreach", kind: "daily", schedule: "8:33 AM Arizona time" },
  { key: "stale-contacts" as const, label: "Move silent leads to the call deck", pipeline: "all", kind: "stale-contacts", schedule: "6:00 AM Arizona time" },
];

async function mailStatus(env: Env): Promise<ConnectionStatus> {
  const destination = describeMailDestination(env);
  const [lastSent, failure, settings] = await Promise.all([
    prisma.outreachRecipient.findFirst({ where: { state: "sent" }, orderBy: { sentAt: "desc" }, select: { sentAt: true } }),
    lastSendFailure(),
    getAppSettings(),
  ]);
  const sentAt = lastSent?.sentAt ?? null;
  const parts = [destination.description, sentAt ? `Last email sent ${formatDateTime(sentAt)}.` : "No email sent yet."];
  const status = (tone: StatusTone, next: string | null): ConnectionStatus => ({ key: "mail", label: "Sending email", tone, summary: parts.join(" "), next });

  if (failure && (!sentAt || failure.at > sentAt)) {
    parts.push(`The last send failed ${formatDateTime(failure.at)}: ${failure.message ?? "the email service refused it"}`);
    return status("error", "Try one send from a lead page. If it fails again, check ZeptoMail's status and the SMTP password in Vercel, or ask your developer.");
  }
  if (settings.outboundPaused) {
    parts.push("Outbound email is paused, so nothing is being sent.");
    return status("warn", "Resume sending in the switches above when you're ready.");
  }
  if (!destination.delivers) return status("warn", "Fine for testing. In production, EMAIL_TRANSPORT must be zeptomail (README → Owner-only setup).");
  return status("ok", null);
}

async function repliesStatus(env: Env, now: Date): Promise<ConnectionStatus> {
  const health = await getReplyHealth(now);
  const received = health.lastReplyAt ? `Last reply received ${formatDateTime(health.lastReplyAt)}.` : "No reply received yet.";
  const base = { key: "replies" as const, label: "Receiving replies" };
  if (!env.EMAIL_INBOUND_SECRET) {
    return {
      ...base,
      tone: "error",
      summary: `EMAIL_INBOUND_SECRET isn't set, so the reply endpoint turns every reply away. ${received}`,
      next: "Set EMAIL_INBOUND_SECRET in Vercel to the token the Cloudflare Email Worker sends.",
    };
  }
  if (health.warning) {
    return {
      ...base,
      tone: "warn",
      summary: `${received} Emails went out 2–7 days ago, but no reply of any kind has arrived for a week — usually a sign the Email Worker isn't reaching the app.`,
      next: "Check the Worker's logs in Cloudflare and Vercel's Protection Bypass for Automation (README → Reply tracking). Meanwhile, mark replies by hand from the lead page.",
    };
  }
  return {
    ...base,
    tone: "ok",
    summary: `${received} The app can't test the Worker's route in from here; a recent reply is the proof that it works.`,
    next: null,
  };
}

async function cronStatus(job: (typeof CRON_JOBS)[number], env: Env, now: Date): Promise<ConnectionStatus> {
  const run = await prisma.pipelineRun.findFirst({ where: { pipeline: job.pipeline, kind: job.kind }, orderBy: { startedAt: "desc" } });
  const base = { key: job.key, label: job.label };
  if (env.VERCEL && !env.CRON_SECRET) {
    return { ...base, tone: "error", summary: "CRON_SECRET isn't set, so the scheduled call is refused.", next: "Set CRON_SECRET in Vercel; Vercel Cron sends it automatically." };
  }
  if (!run) {
    return {
      ...base,
      tone: "warn",
      summary: `Has never run. It is scheduled daily at ${job.schedule}.`,
      next: env.VERCEL ? "Check the Cron Jobs tab of the Vercel project." : "Scheduled runs only happen on Vercel.",
    };
  }
  const status = displayRunStatus(run, now);
  const when = `Last run ${formatDateTime(run.startedAt)}`;
  const summary = `${when}: ${status}${run.summary ? ` — ${run.summary}` : ""}`;
  if (status === "failed" || status === "interrupted") {
    return { ...base, tone: "error", summary, next: "Open the Cold Outreach page for the run's errors; the next run retries automatically." };
  }
  if (isRunOverdue(run.startedAt, now)) {
    return { ...base, tone: "warn", summary: `${summary}. That was over a day ago.`, next: "Check the Cron Jobs tab of the Vercel project." };
  }
  if (status === "partial") return { ...base, tone: "warn", summary, next: "Some sends failed; see the run on the Cold Outreach page." };
  return { ...base, tone: "ok", summary, next: null };
}

function yelpStatus(env: Env): ConnectionStatus {
  return env.YELP_API_KEY
    ? { key: "yelp", label: "Yelp search", tone: "ok", summary: "The Yelp API key is set.", next: null }
    : {
        key: "yelp",
        label: "Yelp search",
        tone: "warn",
        summary: "YELP_API_KEY isn't set, so searches and the daily run can't find businesses.",
        next: "Set YELP_API_KEY in Vercel (.env.example describes every variable).",
      };
}

export async function getConnectionStatus(env: Env = process.env, now: Date = new Date()): Promise<ConnectionStatus[]> {
  const [mail, replies, ...crons] = await Promise.all([
    mailStatus(env),
    repliesStatus(env, now),
    ...CRON_JOBS.map((job) => cronStatus(job, env, now)),
  ]);
  return [mail, replies, ...crons, yelpStatus(env)];
}
