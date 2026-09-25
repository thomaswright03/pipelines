import type { Metadata } from "next";
import ReplyStatus from "@/components/ReplyStatus";
import UnmatchedReplies from "@/components/UnmatchedReplies";
import { listUnmatchedReplies } from "@/lib/outreach/inbound";
import { getReplyHealth } from "@/lib/outreach/reply-health";
import { formatDateTime } from "@/lib/time";
import { getQualitySignals } from "@/lib/outreach/corrections";
import { StatCard } from "@/components/PipelineStatsWidgets";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Replies" };

export default async function RepliesPage() {
  const [health, replies, quality] = await Promise.all([getReplyHealth(), listUnmatchedReplies(50), getQualitySignals()]);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="accent-text text-2xl font-bold tracking-tight">Replies</h1>
        <p className="mt-1 text-sm muted">
          Replies to both pipelines&apos; emails are recorded on the lead with that address automatically. Replies from any other
          address — an assistant, a personal inbox, a forward — wait here until you match them to a lead. Out-of-office and other
          automatic replies are noted on the lead without counting as a reply, and bounce notices mark the email bounced; a
          bounce notice that doesn&apos;t say which address failed waits here too.
        </p>
      </div>

      <section aria-labelledby="tracking-heading" className="card flex flex-col gap-2 p-4">
        <h2 id="tracking-heading" className="text-base font-semibold">
          Reply tracking
        </h2>
        <ReplyStatus health={health} showLink={false} />
      </section>

      <section aria-labelledby="quality-heading" className="card flex flex-col gap-3 p-4">
        <div>
          <h2 id="quality-heading" className="text-base font-semibold">
            How the automatic checks are doing (last {quality.sinceDays} days)
          </h2>
          <p className="mt-1 text-sm muted">
            Each time you correct the app — undo an opt-out it read from a reply, mark someone opted out that it missed, or mark
            a found address bounced — it counts here. Rising numbers mean the rules need a look.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard
            label="Opt-outs read from replies"
            value={quality.autoOptOuts}
            sublabel={`${quality.optOutsReversed.toLocaleString("en-US")} undone by you`}
          />
          <StatCard label="Opt-outs it missed" value={quality.optOutsMissed} sublabel="replies you marked opted out yourself" />
          <StatCard
            label="Replies flagged for a look"
            value={quality.flaggedForReview}
            sublabel={`${quality.wrongPerson.toLocaleString("en-US")} said “wrong person”`}
          />
          <StatCard label="Found addresses that bounced" value={quality.foundAddressesBounced} sublabel="marked bounced by you" />
        </div>
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
            bounce: r.kind === "bounce",
            kindReason: r.kindReason,
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
