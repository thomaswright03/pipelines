// Reply tracking at a glance, on both pipeline pages and the Replies page:
// when the last reply arrived, a warning if replies seem not to be
// arriving, and how many replies are waiting to be matched to a lead.
import Link from "next/link";
import { plural } from "@/lib/format";
import { formatDateTime } from "@/lib/time";
import type { ReplyHealth } from "@/lib/outreach/reply-health";

export default function ReplyStatus({ health, showLink = true }: { health: ReplyHealth; showLink?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      {health.warning ? (
        <p className="notice-warning">
          <strong>No replies recorded lately.</strong> {plural(health.sendsPastGrace, "email")} went out more than 2 days ago, but
          {health.lastReplyAt ? ` the last reply arrived ${formatDateTime(health.lastReplyAt)}` : " no reply has ever been recorded"}.
          Replies may not be reaching the app: mark replies by hand from each lead&apos;s page, and tell your developer that reply
          forwarding needs checking.
        </p>
      ) : (
        <p className="text-sm muted">
          {health.lastReplyAt
            ? `Last reply received ${formatDateTime(health.lastReplyAt)}.`
            : "No replies received yet, so reply tracking isn't confirmed — until the first one arrives, mark replies by hand from the lead's page."}
        </p>
      )}
      {health.unmatched > 0 && (
        <p className="notice-info">
          {plural(health.unmatched, "reply", "replies")} came from an address that isn&apos;t on any lead.{" "}
          {showLink && (
            <Link href="/replies" className="font-medium underline underline-offset-2">
              Match {health.unmatched === 1 ? "it" : "them"} to a lead
            </Link>
          )}
        </p>
      )}
    </div>
  );
}
