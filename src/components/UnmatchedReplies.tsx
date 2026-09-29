"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { attachReplyAction, dismissReplyAction, optOutReplyAction, searchLeadsForReplyAction, type LeadMatch } from "@/lib/actions/replies";
import ActionMessage, { type Feedback } from "@/components/ActionMessage";
import { useConfirm } from "@/components/ConfirmDialog";

type UnmatchedReplyView = {
  id: string;
  fromEmail: string;
  subject: string | null;
  text: string | null;
  optedOut: boolean;
  /** Why the reply needs a look (nothing is emailed to the address until it's dealt with), or null. */
  reviewReason: string | null;
  /** The classifier's verdict: "declined" and "acknowledged" hold the address until the reply is dismissed. */
  verdict: string | null;
  /** A delivery-failure notice whose failed address couldn't be matched to a lead. */
  bounce: boolean;
  kindReason: string | null;
  receivedAt: string; // formatted
};

/** A reply the rules read as interested (and nothing else about it needs a look). */
function isInterested(reply: UnmatchedReplyView): boolean {
  return !reply.bounce && !reply.optedOut && !reply.reviewReason && reply.verdict === "positive";
}

/** The list of replies no lead's address matched, each with "Attach to lead…" and "Dismiss". */
export default function UnmatchedReplies({ replies }: { replies: UnmatchedReplyView[] }) {
  const [feedback, setFeedback] = useState<Feedback>(null);
  if (replies.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <ActionMessage feedback={feedback} />
        <p className="text-sm muted">Nothing to match — every reply so far came from a lead&apos;s own address.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <ActionMessage feedback={feedback} />
      <ul className="flex flex-col gap-3">
        {replies.map((reply) => (
          <ReplyItem key={reply.id} reply={reply} onDone={setFeedback} />
        ))}
      </ul>
    </div>
  );
}

function ReplyItem({ reply, onDone }: { reply: UnmatchedReplyView; onDone: (f: Feedback) => void }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<LeadMatch[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [dialog, confirm] = useConfirm();

  function search(e: React.FormEvent) {
    e.preventDefault();
    setSearchError(null);
    if (query.trim().length < 2) {
      setSearchError("Type at least two letters of the lead's name, company or email.");
      return;
    }
    startTransition(async () => {
      try {
        const result = await searchLeadsForReplyAction(query);
        if (result.ok) setMatches(result.leads);
        else setSearchError(result.error);
      } catch {
        setSearchError("Couldn't reach the server — try again.");
      }
    });
  }

  function act(fn: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>) {
    onDone(null);
    startTransition(async () => {
      try {
        const result = await fn();
        onDone(result.ok ? { ok: true, text: result.message } : { ok: false, text: result.error });
      } catch {
        onDone({ ok: false, text: "Couldn't reach the server — nothing was changed. Try again." });
      }
      router.refresh();
    });
  }

  async function attach(lead: LeadMatch) {
    if (reply.bounce) {
      const confirmed = await confirm({
        title: `Mark the email to ${lead.name} bounced?`,
        body: (
          <p>
            The latest email to {lead.name} ({lead.pipelineLabel}, now {lead.status}) is marked bounced, exactly as with “Mark bounced” on
            the lead page. A lead still being worked moves to Lost.
          </p>
        ),
        confirmLabel: "Mark bounced",
        danger: true,
      });
      if (confirmed) act(() => attachReplyAction(reply.id, lead.pipeline, lead.id));
      return;
    }
    const confirmed = await confirm({
      title: `Add this reply to ${lead.name}?`,
      body: (
        <p>
          It is recorded as {lead.name}&apos;s reply ({lead.pipelineLabel}, now {lead.status}), exactly as if it came from their own
          address.
          {reply.verdict === "declined" && " It reads as a plain no, so a lead still being worked moves to Lost / Not interested."}
          {reply.verdict === "acknowledged" && " It only says thanks, so the lead stays where it is."}
          {reply.optedOut && (
            <> It reads as an opt-out, so {lead.email ? <strong>{lead.email}</strong> : "their address"} goes on the do-not-email list.</>
          )}
        </p>
      ),
      confirmLabel: "Add reply",
      danger: reply.optedOut,
    });
    if (confirmed) act(() => attachReplyAction(reply.id, lead.pipeline, lead.id));
  }

  const holds = reply.verdict === "declined" || reply.verdict === "acknowledged";
  const interested = isInterested(reply);

  async function dismiss() {
    const confirmed = await confirm({
      title: reply.bounce ? `Dismiss this bounce notice?` : `Dismiss the reply from ${reply.fromEmail}?`,
      body: (
        <p>
          It leaves this list without changing any lead.
          {interested && " It reads as interested: no lead is marked as replied unless you attach it."}
          {(reply.reviewReason || holds) &&
            " The address can then be emailed again — if the reply asks to stop, use Mark opted out instead."}
        </p>
      ),
      confirmLabel: "Dismiss",
    });
    if (confirmed) act(() => dismissReplyAction(reply.id));
  }

  async function optOut() {
    const confirmed = await confirm({
      title: `Stop emailing ${reply.fromEmail}?`,
      body: <p>Adds the address to the do-not-email list and removes the reply from this list. Neither pipeline will email it again.</p>,
      confirmLabel: "Add to do-not-email list",
      danger: true,
    });
    if (confirmed) act(() => optOutReplyAction(reply.id));
  }

  return (
    <li className={`card flex flex-col gap-2 p-4 ${interested ? "border-l-4 border-l-emerald-500 dark:border-l-emerald-400" : ""}`}>
      {dialog}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="break-all text-sm font-semibold">{reply.fromEmail}</p>
        <p className="text-sm muted">{reply.receivedAt}</p>
      </div>
      {interested && (
        <p className="notice-success">
          <strong>Interested.</strong> Someone wrote back keen from an address that isn&apos;t on any lead. Find the lead it belongs to and
          attach it, so that lead moves to Responded.
        </p>
      )}
      {reply.bounce && (
        <p className="notice-warning">
          Bounce notice — one of our emails couldn&apos;t be delivered, but the notice doesn&apos;t say which address in a way the app could
          match{reply.kindReason ? ` (${reply.kindReason})` : ""}. Find the lead it was sent to and mark it bounced.
        </p>
      )}
      {reply.subject && <p className="text-sm font-medium">{reply.subject}</p>}
      <p className="whitespace-pre-wrap break-words text-sm">
        {reply.text ?? <span className="muted">(The text of replies from before this list existed wasn&apos;t kept.)</span>}
      </p>
      {reply.optedOut && <p className="notice-warning">Read as an opt-out: {reply.fromEmail} is already on the do-not-email list.</p>}
      {!reply.reviewReason && holds && (
        <p className="notice-info">
          {reply.verdict === "declined" ? "Read as a plain no" : "Only says thanks"} — not an opt-out and nothing to act on, but nothing
          more is emailed to this address. Attach it to the lead it belongs to, or dismiss it.
        </p>
      )}
      {reply.reviewReason && (
        <div className="notice-warning flex flex-col gap-2">
          <p>
            <strong>Needs a look.</strong> {reply.reviewReason} Nothing is emailed to this address until you attach, opt out or dismiss it.
          </p>
          <button type="button" disabled={isPending} onClick={optOut} className="btn-danger self-start">
            Mark opted out
          </button>
        </div>
      )}
      <form onSubmit={search} className="flex flex-wrap items-end gap-2">
        <label className="field-label min-w-0 flex-1">
          {reply.bounce ? "Find the lead whose email bounced" : "Find the lead it belongs to"}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, company or email"
            maxLength={100}
            className="input"
          />
        </label>
        <button type="submit" disabled={isPending} className="btn-secondary">
          Search
        </button>
        <button type="button" disabled={isPending} onClick={dismiss} className="btn-secondary">
          Dismiss
        </button>
      </form>
      {searchError && <p className="field-error">{searchError}</p>}
      {matches && matches.length === 0 && <p className="text-sm muted">No leads match “{query}”.</p>}
      {matches && matches.length > 0 && (
        <ul className="flex flex-col divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
          {matches.map((lead) => (
            <li key={`${lead.pipeline}:${lead.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0 break-words">
                <strong>{lead.name}</strong> {lead.email && <span className="muted">· {lead.email}</span>}{" "}
                <span className="muted">
                  · {lead.pipelineLabel} · {lead.status}
                </span>
              </span>
              <button type="button" disabled={isPending} onClick={() => attach(lead)} className="btn-secondary">
                {reply.bounce ? "Mark bounced" : "Attach"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
