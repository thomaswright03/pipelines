// "Is reply tracking working?" Replies reach the app only through an
// external email Worker (README → Reply tracking). If it breaks, the app
// just sees no replies — which looks the same as nobody replying and skews
// the reply rate. So the pages show when the last reply arrived and warn
// when emails have gone out but no reply of any kind has been recorded for
// a week.
import { prisma } from "@/lib/db";
import { countUnmatchedReplies, lastInboundReplyAt } from "@/lib/outreach/inbound";

const DAY_MS = 24 * 60 * 60 * 1000;
/** A week without any inbound message while emails are out is a warning. */
export const REPLY_WATCH_WINDOW_DAYS = 7;
/** Sends younger than this haven't had a fair chance of a reply yet. */
const REPLY_GRACE_DAYS = 2;

export type ReplyHealth = {
  lastReplyAt: Date | null;
  unmatched: number;
  /** Emails sent more than 2 days ago (any age beyond that). */
  sendsPastGrace: number;
  warning: boolean;
};

/**
 * Warn when emails sent more than 2 days ago exist — however old — yet no
 * inbound message of any kind (reply, automatic reply or bounce, matched or
 * not) has been recorded in the last 7 days.
 */
export function shouldWarn(sendsPastGrace: number, lastReplyAt: Date | null, now: Date): boolean {
  if (sendsPastGrace === 0) return false;
  return !lastReplyAt || now.getTime() - lastReplyAt.getTime() > REPLY_WATCH_WINDOW_DAYS * DAY_MS;
}

/** Whether an inbound message has been recorded within the last 7 days. */
export function replyIsRecent(lastReplyAt: Date | null, now: Date): boolean {
  return lastReplyAt !== null && now.getTime() - lastReplyAt.getTime() <= REPLY_WATCH_WINDOW_DAYS * DAY_MS;
}

export async function getReplyHealth(now: Date = new Date()): Promise<ReplyHealth> {
  const [lastReplyAt, unmatched, sendsPastGrace] = await Promise.all([
    lastInboundReplyAt(),
    countUnmatchedReplies(),
    prisma.outreachRecipient.count({
      where: { state: "sent", sentAt: { lte: new Date(now.getTime() - REPLY_GRACE_DAYS * DAY_MS) } },
    }),
  ]);
  return { lastReplyAt, unmatched, sendsPastGrace, warning: shouldWarn(sendsPastGrace, lastReplyAt, now) };
}
