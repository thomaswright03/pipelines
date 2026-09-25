import type { Metadata } from "next";
import ReplyStatus from "@/components/ReplyStatus";
import UnmatchedReplies from "@/components/UnmatchedReplies";
import { listUnmatchedReplies } from "@/lib/outreach/inbound";
import { getReplyHealth } from "@/lib/outreach/reply-health";
import { formatDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Replies" };

export default async function RepliesPage() {
  const [health, replies] = await Promise.all([getReplyHealth(), listUnmatchedReplies(50)]);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="accent-text text-2xl font-bold tracking-tight">Replies</h1>
        <p className="mt-1 text-sm muted">
          Replies to both pipelines&apos; emails are recorded on the lead with that address automatically. Replies from any other
          address — an assistant, a personal inbox, a forward — wait here until you match them to a lead.
        </p>
      </div>

      <section aria-labelledby="tracking-heading" className="card flex flex-col gap-2 p-4">
        <h2 id="tracking-heading" className="text-base font-semibold">
          Reply tracking
        </h2>
        <ReplyStatus health={health} showLink={false} />
      </section>

      <section aria-labelledby="unmatched-heading" className="flex flex-col gap-3">
        <h2 id="unmatched-heading" className="text-base font-semibold">
          Replies from unknown addresses ({health.unmatched})
        </h2>
        <UnmatchedReplies
          replies={replies.map((r) => ({
            id: r.id,
            fromEmail: r.fromEmail,
            subject: r.subject,
            text: r.text,
            optedOut: r.optedOut,
            receivedAt: formatDateTime(r.receivedAt),
          }))}
        />
        {health.unmatched > replies.length && (
          <p className="text-sm muted">Showing the latest {replies.length}. Deal with these to see older ones.</p>
        )}
      </section>
    </div>
  );
}
