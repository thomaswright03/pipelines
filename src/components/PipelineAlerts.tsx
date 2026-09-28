// Problems the operator should see before the lead list on a pipeline page:
// replies not arriving, replies waiting to be matched, a daily run that
// stopped. Renders nothing when all is well; the full reply status and the
// run history stay with the tools below the list.
import Link from "next/link";
import { plural } from "@/lib/format";
import { formatDateTime } from "@/lib/time";
import type { ReplyHealth } from "@/lib/outreach/reply-health";

export default function PipelineAlerts({ replyHealth, staleWarning = null }: { replyHealth: ReplyHealth; staleWarning?: string | null }) {
  if (!replyHealth.warning && replyHealth.unmatched === 0 && !staleWarning) return null;
  return (
    <div className="flex flex-col gap-2">
      {staleWarning && <p className="notice-warning">{staleWarning}</p>}
      {replyHealth.warning && (
        <p className="notice-warning">
          <strong>No replies recorded lately</strong>
          {replyHealth.lastReplyAt ? ` (last one ${formatDateTime(replyHealth.lastReplyAt)})` : ""} — replies may not be reaching the app.{" "}
          <a href="#tools" className="font-medium underline underline-offset-2">
            What to do
          </a>
        </p>
      )}
      {replyHealth.unmatched > 0 && (
        <p className="notice-info">
          {plural(replyHealth.unmatched, "reply", "replies")} came from an address that isn&apos;t on any lead.{" "}
          <Link href="/replies" className="font-medium underline underline-offset-2">
            Match {replyHealth.unmatched === 1 ? "it" : "them"} to a lead
          </Link>
        </p>
      )}
    </div>
  );
}
