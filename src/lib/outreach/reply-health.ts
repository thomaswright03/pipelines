// "Is reply tracking working?" Replies reach the app only through an
// external email Worker (docs/deployment.md → "Reply tracking"). If it
// breaks, the app just sees no replies — which looks the same as nobody
// replying, skews the reply rate and, worst, leaves opt-outs unrecorded
// while outreach goes on. So every page's header and the dashboard warn,
// and the pipeline and Replies pages say when the last reply arrived, as
// soon as pitches that are more than 2 days old have had no inbound message
// of any kind (reply, automatic reply or bounce, matched or not) after them.
import { prisma } from "@/lib/db";
import { countUnmatchedReplies, lastInboundReplyAt } from "@/lib/outreach/inbound";

const DAY_MS = 24 * 60 * 60 * 1000;
/** A week without any inbound message while emails are out is a warning. */
export const REPLY_WATCH_WINDOW_DAYS = 7;
/** Sends younger than this haven't had a fair chance of a reply yet. */
export const REPLY_GRACE_DAYS = 2;
/**
 * This many pitches past the grace period without a single inbound message
 * after them — not even an out-of-office or a bounce — is a warning even
 * within the week: at the few-percent rate of those alone, it is unlikely.
 */
export const SILENT_SENDS_THRESHOLD = 20;

export type ReplyHealth = {
  lastReplyAt: Date | null;
  unmatched: number;
  /** Emails sent more than 2 days ago (any age beyond that). */
  sendsPastGrace: number;
  /** Of those, the ones sent after the last inbound message arrived. */
  sendsSinceLastReply: number;
  warning: boolean;
  /** Why it warns: no inbound message ever, none for a week, or many sends without one. */
  reason: "never" | "silent_week" | "silent_sends" | null;
};

/**
 * Whether replies look like they aren't reaching the app: pitches more than
 * 2 days old exist, and no inbound message has ever arrived, or none in the
 * last 7 days, or at least SILENT_SENDS_THRESHOLD of those pitches went out
 * after the last one.
 */
export function warningReason(sendsPastGrace: number, lastReplyAt: Date | null, now: Date, sendsSinceLastReply = 0): ReplyHealth["reason"] {
  if (sendsPastGrace === 0) return null;
  if (!lastReplyAt) return "never";
  if (now.getTime() - lastReplyAt.getTime() > REPLY_WATCH_WINDOW_DAYS * DAY_MS) return "silent_week";
  if (sendsSinceLastReply >= SILENT_SENDS_THRESHOLD) return "silent_sends";
  return null;
}

export function shouldWarn(sendsPastGrace: number, lastReplyAt: Date | null, now: Date, sendsSinceLastReply = 0): boolean {
  return warningReason(sendsPastGrace, lastReplyAt, now, sendsSinceLastReply) !== null;
}

/** Whether an inbound message has been recorded within the last 7 days. */
export function replyIsRecent(lastReplyAt: Date | null, now: Date): boolean {
  return lastReplyAt !== null && now.getTime() - lastReplyAt.getTime() <= REPLY_WATCH_WINDOW_DAYS * DAY_MS;
}

export async function getReplyHealth(now: Date = new Date()): Promise<ReplyHealth> {
  const graceCutoff = new Date(now.getTime() - REPLY_GRACE_DAYS * DAY_MS);
  const [lastReplyAt, unmatched, sendsPastGrace] = await Promise.all([
    lastInboundReplyAt(),
    countUnmatchedReplies(),
    prisma.outreachRecipient.count({ where: { state: "sent", sentAt: { lte: graceCutoff } } }),
  ]);
  const sendsSinceLastReply =
    lastReplyAt && sendsPastGrace > 0
      ? await prisma.outreachRecipient.count({ where: { state: "sent", sentAt: { lte: graceCutoff, gt: lastReplyAt } } })
      : sendsPastGrace;
  const reason = warningReason(sendsPastGrace, lastReplyAt, now, sendsSinceLastReply);
  return { lastReplyAt, unmatched, sendsPastGrace, sendsSinceLastReply, warning: reason !== null, reason };
}
