// Reply tracking at a glance, on both pipeline pages and the Replies page:
// when the last reply arrived, a warning if replies seem not to be
// arriving (also on the dashboard), and how many replies are waiting to be
// matched to a lead.
import Link from "next/link";
import { plural } from "@/lib/format";
import { formatDateTime } from "@/lib/time";
import type { ReplyHealth } from "@/lib/outreach/reply-health";

/** `showUnmatched: false` where PipelineAlerts already reports replies waiting to be matched. */
export default function ReplyStatus({
  health,
  showLink = true,
  showUnmatched = true,
}: {
  health: ReplyHealth;
  showLink?: boolean;
  showUnmatched?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      {health.warning ? (
        <ReplyIntakeWarning health={health} />
      ) : (
        <p className="text-sm muted">
          {health.lastReplyAt
            ? `Last reply received ${formatDateTime(health.lastReplyAt)}.`
            : "No replies received yet, so reply tracking isn't confirmed — until the first one arrives, mark replies by hand from the lead's page."}
        </p>
      )}
      {showUnmatched && <UnmatchedRepliesNotice health={health} showLink={showLink} />}
    </div>
  );
}

/**
 * "3 replies came from an address that isn't on any lead — 1 reads as
 * interested." Interested ones are a live prospect writing from another
 * address, so they are called out (and styled) apart from the rest.
 */
export function UnmatchedRepliesNotice({ health, showLink = true }: { health: ReplyHealth; showLink?: boolean }) {
  if (health.unmatched === 0) return null;
  const interested = health.unmatchedInterested;
  const which = interested < health.unmatched ? String(interested) : health.unmatched === 1 ? "it" : "all";
  return (
    <p className={interested > 0 ? "notice-success" : "notice-info"}>
      {plural(health.unmatched, "reply", "replies")} came from an address that isn&apos;t on any lead
      {interested > 0 && (
        <>
          {" "}
          — <strong>{which === "it" ? "it reads" : `${which} read`} as interested</strong>
        </>
      )}
      .{" "}
      {showLink && (
        <Link href="/replies" className="font-medium underline underline-offset-2">
          Match {health.unmatched === 1 ? "it" : "them"} to a lead
        </Link>
      )}
    </p>
  );
}

/**
 * The warning that replies — opt-outs among them — aren't reaching the
 * app, with what to do meanwhile. Shown on the dashboard, the pipeline pages
 * and the Replies page; every page's header links here.
 */
export function ReplyIntakeWarning({ health }: { health: ReplyHealth }) {
  const since =
    health.reason === "never"
      ? "no reply of any kind has ever been recorded"
      : health.reason === "silent_sends"
        ? `${plural(health.sendsSinceLastReply, "of them", "of them")} went out after the last reply arrived (${formatDateTime(health.lastReplyAt!)}) and nothing — not even an out-of-office or a bounce — has come back since`
        : `the last reply arrived ${formatDateTime(health.lastReplyAt!)}`;
  return (
    <div role="alert" className="notice-error flex flex-col gap-1">
      <p>
        <strong>Replies don&apos;t seem to be reaching the app.</strong> {plural(health.sendsPastGrace, "email")} went out more than 2 days
        ago, but {since}. Opt-outs sent meanwhile are not being recorded.
      </p>
      <p>
        Until this is fixed: read the sending inbox by hand, use <strong>Mark opted out</strong> on each lead who asked to stop and{" "}
        <strong>Mark replied</strong> on each who answered, and pause outbound email in Settings if you can&apos;t keep up. Tell your
        developer that reply forwarding needs checking.
      </p>
    </div>
  );
}
