// "Is reply tracking working?" Replies reach the app only through an
// external email Worker (README → Reply tracking). If it breaks, the app
// just sees no replies — which looks the same as nobody replying and skews
// the reply rate. So the pages show when the last reply arrived and warn
// when emails have gone out for days with no reply recorded at all.
import { prisma } from "@/lib/db";
import { countUnmatchedReplies, lastInboundReplyAt } from "@/lib/outreach/inbound";

const DAY_MS = 24 * 60 * 60 * 1000;
/** How far back sends are counted. */
export const REPLY_WATCH_WINDOW_DAYS = 7;
/** Sends younger than this haven't had a fair chance of a reply yet. */
export const REPLY_GRACE_DAYS = 2;

export type ReplyHealth = {
  lastReplyAt: Date | null;
  unmatched: number;
  /** Emails sent between 7 and 2 days ago. */
  sendsToWatch: number;
  warning: boolean;
};

/**
 * Warn when emails sent 2–7 days ago exist, yet no reply of any kind
 * (matched or not) has been recorded in the last 7 days.
 */
export function shouldWarn(sendsToWatch: number, lastReplyAt: Date | null, now: Date): boolean {
  if (sendsToWatch === 0) return false;
  return !lastReplyAt || now.getTime() - lastReplyAt.getTime() > REPLY_WATCH_WINDOW_DAYS * DAY_MS;
}

export async function getReplyHealth(now: Date = new Date()): Promise<ReplyHealth> {
  const [lastReplyAt, unmatched, sendsToWatch] = await Promise.all([
    lastInboundReplyAt(),
    countUnmatchedReplies(),
    prisma.outreachRecipient.count({
      where: {
        state: "sent",
        sentAt: {
          gte: new Date(now.getTime() - REPLY_WATCH_WINDOW_DAYS * DAY_MS),
          lte: new Date(now.getTime() - REPLY_GRACE_DAYS * DAY_MS),
        },
      },
    }),
  ]);
  return { lastReplyAt, unmatched, sendsToWatch, warning: shouldWarn(sendsToWatch, lastReplyAt, now) };
}
