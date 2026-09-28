// Both pipelines' Inbox pages: what was sent, what failed, and who replied.
import type { ReactNode } from "react";
import Link from "next/link";
import { INBOX_LIMIT, type InboxTab, type PipelineInbox } from "@/lib/outreach/inbox";
import { formatDateTime } from "@/lib/time";
import type { PipelineId } from "@/lib/outreach/pipeline-id";
import { replySubject } from "@/lib/outreach/reply-send";
import InboxReplyForm from "@/components/InboxReplyForm";

const TAB_LABEL: Record<InboxTab, string> = { sent: "Sent", failed: "Failed", replied: "Replied" };

const TAB_HELP: Record<InboxTab, string> = {
  sent: "Every email this pipeline sent that the mail provider accepted and that hasn't bounced, newest first.",
  failed:
    "Sends that didn't get through: bounced, refused by the recipient's mail server, dropped mid-send so delivery can't be confirmed, or errored. Each address is listed once.",
  replied:
    "Replies people wrote back, newest first, with how the app read each one. Out-of-office and other automatic replies aren't counted. Leads you marked replied by hand are here too. Reply sends your answer from the app, in the same email thread.",
};

const FAILURE_LABEL: Record<string, string> = {
  bounced: "Bounced",
  refused: "Refused by mail server",
  unknown: "Delivery unconfirmed",
  failed: "Send failed",
};

const VERDICT: Record<string, { label: string; tone: string }> = {
  positive: { label: "Interested", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" },
  needs_look: { label: "Needs a look", tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" },
  declined: { label: "Said no", tone: "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200" },
  acknowledged: { label: "Thanks only", tone: "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200" },
  opt_out: { label: "Opted out", tone: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200" },
  marked: { label: "Marked replied", tone: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200" },
};

const PILL = "inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium";

export default function PipelineInboxPage({
  pipeline,
  title,
  basePath,
  inbox,
}: {
  pipeline: PipelineId;
  title: string;
  basePath: string;
  inbox: PipelineInbox;
}) {
  const { tab, counts } = inbox;
  const rows = inbox[tab];
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="accent-text text-2xl font-bold tracking-tight">{title} — Inbox</h1>
        <p className="mt-1 text-sm muted">{TAB_HELP[tab]}</p>
      </div>

      <nav aria-label="Inbox folders" className="flex flex-wrap gap-1.5">
        {(Object.keys(TAB_LABEL) as InboxTab[]).map((t) => (
          <Link
            key={t}
            href={`${basePath}/inbox?tab=${t}`}
            aria-current={t === tab ? "page" : undefined}
            className={t === tab ? "tab-active" : "tab-inactive"}
          >
            {TAB_LABEL[t]} ({counts[t].toLocaleString("en-US")})
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <p className="card p-4 text-sm muted">{EMPTY[tab]}</p>
      ) : (
        <ul className="card divide-y divide-zinc-200 dark:divide-zinc-800">
          {tab === "sent" &&
            inbox.sent.map((s) => (
              <Row key={s.id} basePath={basePath} leadId={s.leadId} leadName={s.leadName} email={s.email} at={s.sentAt}>
                <p className="truncate text-sm">{s.subject ?? <span className="muted">(subject not recorded)</span>}</p>
              </Row>
            ))}
          {tab === "failed" &&
            inbox.failed.map((f) => (
              <Row key={f.id} basePath={basePath} leadId={f.leadId} leadName={f.leadName} email={f.email} at={f.at}>
                <p className="text-sm">
                  <span className={`${PILL} bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200`}>{FAILURE_LABEL[f.kind]}</span>
                  {f.detail && <span className="ml-2 break-words muted">{f.detail}</span>}
                </p>
              </Row>
            ))}
          {tab === "replied" &&
            inbox.replied.map((r) => {
              const v = r.verdict ? VERDICT[r.verdict] : undefined;
              return (
                <Row key={r.id} basePath={basePath} leadId={r.leadId} leadName={r.leadName} email={r.email} at={r.at}>
                  <div className="flex flex-col gap-1 text-sm">
                    <p className="flex flex-wrap items-center gap-2">
                      {v && <span className={`${PILL} ${v.tone}`}>{v.label}</span>}
                      {r.subject && <span className="truncate font-medium">{r.subject}</span>}
                    </p>
                    {r.text && <p className="line-clamp-3 whitespace-pre-line break-words muted">{r.text}</p>}
                    {r.ourReplyAt && r.ourReplyAt >= r.at && <p className="text-xs muted">You replied {formatDateTime(r.ourReplyAt)}</p>}
                    {r.canReply && (
                      <InboxReplyForm
                        pipeline={pipeline}
                        replyId={r.id}
                        to={r.email}
                        subject={replySubject(r.subject)}
                        disabledReason={
                          r.optedOut ? "Opted out: this address is on the do-not-email list, so you can't reply from here." : null
                        }
                      />
                    )}
                  </div>
                </Row>
              );
            })}
        </ul>
      )}
      {counts[tab] > INBOX_LIMIT && (
        <p className="text-xs muted">
          Showing the newest {INBOX_LIMIT.toLocaleString("en-US")} of {counts[tab].toLocaleString("en-US")}.
        </p>
      )}
    </div>
  );
}

const EMPTY: Record<InboxTab, string> = {
  sent: "Nothing sent yet.",
  failed: "No failed sends.",
  replied: "No replies yet.",
};

function Row({
  basePath,
  leadId,
  leadName,
  email,
  at,
  children,
}: {
  basePath: string;
  leadId: string | null;
  leadName: string | null;
  email: string;
  at: Date;
  children: ReactNode;
}) {
  return (
    <li className="flex flex-col gap-1 p-3 sm:flex-row sm:items-start sm:gap-4">
      <div className="min-w-0 sm:w-64 sm:shrink-0">
        {leadId && leadName ? (
          <Link href={`${basePath}/${leadId}`} className="font-medium hover:underline">
            {leadName}
          </Link>
        ) : (
          <span className="font-medium muted">No lead</span>
        )}
        <p className="truncate text-xs muted">{email || "—"}</p>
      </div>
      <div className="min-w-0 flex-1">{children}</div>
      <time dateTime={at.toISOString()} className="whitespace-nowrap text-xs muted">
        {formatDateTime(at)}
      </time>
    </li>
  );
}
