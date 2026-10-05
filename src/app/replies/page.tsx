import type { Metadata } from "next";
import Link from "next/link";
import { PIPELINE_BASE_PATH, PIPELINE_IDS, PIPELINE_LABEL } from "@/lib/outreach/pipeline-id";
import HowThisWorks from "@/components/HowThisWorks";
import ReplyStatus from "@/components/ReplyStatus";
import UnmatchedReplies from "@/components/UnmatchedReplies";
import { listUnmatchedReplies } from "@/lib/outreach/inbound";
import { getReplyHealth } from "@/lib/outreach/reply-health";
import { formatDateTime } from "@/lib/time";
import { getQualitySignals } from "@/lib/outreach/corrections";
import { StatCard } from "@/components/PipelineStatsWidgets";
import FinderQuality from "@/components/FinderQuality";
import { getFinderQuality } from "@/lib/outreach/finder-quality";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Unmatched replies" };

const LINK = "font-medium text-indigo-700 underline underline-offset-2 dark:text-indigo-300";

export default async function RepliesPage() {
  const [health, replies, quality, finder] = await Promise.all([
    getReplyHealth(),
    listUnmatchedReplies(50),
    getQualitySignals(),
    getFinderQuality(),
  ]);
  const others = health.unmatched - health.unmatchedInterested;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="accent-text text-2xl font-bold tracking-tight">Unmatched replies</h1>
        <p className="text-sm muted">
          Only replies from an address that isn&apos;t on any lead wait here. A reply from a lead&apos;s own address is recorded on the lead
          and listed on its pipeline&apos;s <em>Sent &amp; replies</em> tab:{" "}
          {PIPELINE_IDS.map((p, i) => (
            <span key={p}>
              {i > 0 && (i === PIPELINE_IDS.length - 1 ? " or " : ", ")}
              <Link href={`${PIPELINE_BASE_PATH[p]}/inbox?tab=replied`} className={LINK}>
                {PIPELINE_LABEL[p]}
              </Link>
            </span>
          ))}
          .
        </p>
        <p className="text-sm">
          {health.unmatched > 0
            ? "Match each reply below to the lead it belongs to, or dismiss it."
            : health.lastReplyAt === null
              ? "No replies have arrived yet. Each one will be recorded on the lead with that address; any from another address will wait here."
              : "Nothing to do here: every reply so far came from a lead's own address and was recorded on that lead."}
        </p>
        <HowThisWorks>
          <p>
            Replies to every pipeline&apos;s emails are recorded on the lead with that address automatically. Replies from any other address
            — an assistant, a personal inbox, a forward — wait here until you match them to a lead. Interested ones are listed first.
          </p>
          <p>
            Out-of-office and other automatic replies are noted on the lead without counting as a reply, and bounce notices mark the email
            bounced; a bounce notice that doesn&apos;t say which address failed waits here too.
          </p>
        </HowThisWorks>
      </div>

      <section aria-labelledby="unmatched-heading" className="flex flex-col gap-3">
        <div>
          <h2 id="unmatched-heading" className="text-base font-semibold">
            Replies from unknown addresses ({health.unmatched})
          </h2>
          {health.unmatched > 0 && (
            <p className="mt-1 text-sm muted">
              {health.unmatchedInterested > 0 ? (
                <>
                  <strong className="text-emerald-800 dark:text-emerald-300">{health.unmatchedInterested} interested</strong>
                  {others > 0 ? `, listed first; ${others} other${others === 1 ? "" : "s"}.` : "."}
                </>
              ) : (
                "None reads as interested."
              )}
            </p>
          )}
        </div>
        <UnmatchedReplies
          replies={replies.map((r) => ({
            id: r.id,
            fromEmail: r.fromEmail,
            subject: r.subject,
            text: r.text,
            optedOut: r.optedOut,
            reviewReason: r.reviewReason,
            verdict: r.verdict,
            bounce: r.kind === "bounce",
            kindReason: r.kindReason,
            receivedAt: formatDateTime(r.receivedAt),
          }))}
        />
        {health.unmatched > replies.length && (
          <p className="text-sm muted">Showing the latest {replies.length}. Deal with these to see older ones.</p>
        )}
      </section>

      <section aria-labelledby="tracking-heading" className="card flex flex-col gap-2 p-4">
        <h2 id="tracking-heading" className="text-base font-semibold">
          Reply tracking
        </h2>
        <ReplyStatus health={health} showLink={false} showUnmatched={false} />
      </section>

      <section aria-labelledby="quality-heading" className="card flex flex-col gap-3 p-4">
        <div>
          <h2 id="quality-heading" className="text-base font-semibold">
            How the automatic checks are doing (last {quality.sinceDays} days)
          </h2>
          <p className="mt-1 text-sm muted">
            Each time you correct the app — undo an opt-out it read from a reply, mark someone opted out that it missed, reopen a lead it
            closed on a “no”, count a thank-you as a reply, or mark a found address bounced — it counts here. Rising numbers mean the rules
            need a look.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
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
          <StatCard
            label="Plain no's closed automatically"
            value={quality.declined}
            sublabel={`${quality.declinesReversed.toLocaleString("en-US")} reopened by you`}
          />
          <StatCard
            label="Thank-you-only replies"
            value={quality.acknowledged}
            sublabel={`${quality.courtesyWasReply.toLocaleString("en-US")} you counted as a reply`}
          />
          <StatCard label="Found addresses that bounced" value={quality.foundAddressesBounced} sublabel="marked bounced by you" />
        </div>
      </section>

      <section aria-labelledby="finder-heading" className="card flex flex-col gap-3 p-4">
        <div>
          <h2 id="finder-heading" className="text-base font-semibold">
            How found addresses are doing (last {finder.sinceDays} days)
          </h2>
          <p className="mt-1 text-sm muted">
            Addresses the lookup found, by version of its rules, next to ones typed in by hand. A found address that bounces, reaches the
            wrong person or had to be replaced means the lookup picked the wrong one; compare a new rules version with the one before it.
          </p>
        </div>
        <FinderQuality data={finder} />
      </section>
    </div>
  );
}
