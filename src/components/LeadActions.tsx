"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  confirmAddressAction,
  deleteLeadAction,
  dismissReplyReviewAction,
  findLeadEmailAction,
  markBouncedAction,
  markOptedOutAction,
  markRepliedAction,
  removeSuppressionAction,
  sendOutreachEmailAction,
  setOurReplyAction,
  updateLeadStatusAction,
} from "@/lib/actions/outreach";
import { allowedTransitions, CALL_OUTCOME_LABEL, canMarkReplied, isBackwardMove, LOST_REASONS, statusLabel } from "@/lib/lead-status";
import type { ActionResult } from "@/lib/outreach/lead-actions";
import { PIPELINE_BASE_PATH, type PipelineId } from "@/lib/outreach/pipeline-id";
import StatusBadge from "@/components/StatusBadge";
import ActionMessage, { type Feedback } from "@/components/ActionMessage";
import { useConfirm } from "@/components/ConfirmDialog";

export type LeadActionsLead = {
  id: string;
  name: string;
  status: string;
  email: string | null;
  sendBlockedReason: string | null;
  emailed: boolean;
  /** Every send to this lead is already marked bounced. */
  bounced: boolean;
  replied: boolean;
  ourReplied: boolean;
  replyNeedsReview: boolean;
  /** Why the reply needs a look (shown with the flag). */
  replyReviewReason: string | null;
};

/** Long replies are shown up to this many characters; the full text is in the history below. */
const REPLY_PREVIEW_CHARS = 600;
const clipReply = (text: string) => (text.length > REPLY_PREVIEW_CHARS ? `${text.slice(0, REPLY_PREVIEW_CHARS)}…` : text);

// Mirrors BOUNCE_MOVES_TO_LOST in src/lib/outreach/lead-actions.ts.
const BOUNCE_ENDS_OUTREACH = ["contacted", "responded", "cold_call_list", "contactless_list"];

const LOST_REASON_CHOICES = LOST_REASONS.map((value) => ({ value, label: CALL_OUTCOME_LABEL[value] ?? value }));

/** The latest reply recorded on the lead, shown in its own words when it needs a look. */
export type LatestReply = { text: string; receivedAt: string /* already formatted in the app's time zone */ };

export type LeadSuppression = {
  source: string | null;
  evidence: string | null;
  reason: string | null;
  since: string; // already formatted in the app's time zone
};

/**
 * The status control and email actions on a lead page, for both pipelines.
 * Only moves and actions that make sense for the lead's current state are
 * offered (the server enforces the same rules); consequential ones ask for
 * confirmation first and every outcome is reported in plain words.
 */
export default function LeadActions({
  pipeline,
  lead,
  suppression,
  paused,
  latestReply = null,
}: {
  pipeline: PipelineId;
  lead: LeadActionsLead;
  suppression: LeadSuppression | null;
  paused: boolean;
  latestReply?: LatestReply | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [dialog, confirm, choose] = useConfirm();

  function run(fn: () => Promise<ActionResult>) {
    setFeedback(null);
    startTransition(async () => {
      try {
        const result = await fn();
        setFeedback(result.ok ? { ok: true, text: result.message } : { ok: false, text: result.error });
      } catch {
        setFeedback({ ok: false, text: "Couldn't reach the server — nothing was changed. Check your connection and try again." });
      }
      router.refresh();
    });
  }

  const basePath = PIPELINE_BASE_PATH[pipeline];
  const moves = allowedTransitions(pipeline, lead.status);
  const needsAddressCheck = Boolean(lead.email && lead.sendBlockedReason?.startsWith("Unverified address"));

  async function remove() {
    const confirmed = await confirm({
      title: `Delete ${lead.name}?`,
      body: (
        <>
          <p>Removes {lead.name} and their notes from the list. This can&apos;t be undone.</p>
          {lead.email && (
            <p className="mt-2">
              The send history is kept: if <strong>{lead.email}</strong> was already emailed, it still counts as pitched and won&apos;t be
              emailed again.
            </p>
          )}
        </>
      ),
      confirmLabel: `Delete ${lead.name}`,
      danger: true,
    });
    if (!confirmed) return;
    setFeedback(null);
    startTransition(async () => {
      try {
        const result = await deleteLeadAction(pipeline, lead.id);
        if (result.ok) {
          router.push(basePath);
          router.refresh();
          return;
        }
        setFeedback({ ok: false, text: result.error });
      } catch {
        setFeedback({ ok: false, text: "Couldn't reach the server — nothing was deleted. Check your connection and try again." });
      }
    });
  }
  const canSend = lead.status === "new" && Boolean(lead.email) && !suppression && !lead.sendBlockedReason && !lead.replyNeedsReview;
  const showMarkReplied = canMarkReplied(lead.status) && (lead.status === "contacted" || lead.emailed);

  async function keep() {
    const confirmed = await confirm({
      title: `Keep ${lead.name} as ${statusLabel(lead.status)}?`,
      body: (
        <p>
          Only if the reply doesn&apos;t ask to stop emails — otherwise use Mark opted out.
          {lead.status === "contacted" && " Without a reply counted, the lead moves to phone outreach a week after the pitch."}
          {lead.status === "new" && " The lead can then be emailed."}
        </p>
      ),
      confirmLabel: `Keep as ${statusLabel(lead.status)}`,
    });
    if (confirmed) run(() => dismissReplyReviewAction(pipeline, lead.id));
  }

  async function moveTo(to: string) {
    if (to === "lost") {
      // The one way to mark a lead Lost, in both pipelines: it always records why.
      const reason = await choose({
        title: `Mark ${lead.name} as Lost?`,
        body: <p>From {statusLabel(lead.status)} to Lost. No further outreach goes to this lead.</p>,
        choiceLabel: "Why was the lead lost?",
        choices: LOST_REASON_CHOICES,
        confirmLabel: "Mark lost",
        danger: true,
      });
      if (reason) run(() => updateLeadStatusAction(pipeline, lead.id, to, reason));
      return;
    }
    const backward = isBackwardMove(lead.status, to);
    const confirmed = await confirm({
      title: `${backward ? "Move back" : "Move"} ${lead.name} to ${statusLabel(to)}?`,
      body: (
        <p>
          From {statusLabel(lead.status)} to {statusLabel(to)}.
          {to === "contacted" && " This undoes “Mark replied” — the reply time is cleared."}
          {to === "not_interested" && " No further outreach goes to this lead."}
        </p>
      ),
      confirmLabel: `${backward ? "Move back" : "Move"} to ${statusLabel(to)}`,
    });
    if (confirmed) run(() => updateLeadStatusAction(pipeline, lead.id, to));
  }

  async function send() {
    const confirmed = await confirm({
      title: `Email ${lead.name}?`,
      body: (
        <p>
          Sends the first outreach email to <strong>{lead.email}</strong> and moves the lead to Contacted. Each address is only ever pitched
          once.
        </p>
      ),
      confirmLabel: "Send email",
    });
    if (confirmed) run(() => sendOutreachEmailAction(pipeline, lead.id));
  }

  async function optOut() {
    const confirmed = await confirm({
      title: `Stop emailing ${lead.email}?`,
      body: <p>Adds the address to the do-not-email list. Neither pipeline will email it again unless you remove it.</p>,
      confirmLabel: "Add to do-not-email list",
      danger: true,
    });
    if (confirmed) run(() => markOptedOutAction(pipeline, lead.id));
  }

  async function bounced() {
    const confirmed = await confirm({
      title: `Mark the email to ${lead.name} as bounced?`,
      body: (
        <p>
          Records the latest send as bounced
          {BOUNCE_ENDS_OUTREACH.includes(lead.status) ? " and moves the lead to Lost." : `. The lead stays ${statusLabel(lead.status)}.`}
        </p>
      ),
      confirmLabel: "Mark bounced",
      danger: true,
    });
    if (confirmed) run(() => markBouncedAction(pipeline, lead.id));
  }

  async function unsuppress() {
    const confirmed = await confirm({
      title: `Remove ${lead.email} from the do-not-email list?`,
      body: (
        <p>
          Only do this if they did <strong>not</strong> ask to stop — for example, an interested reply that was misread. Both pipelines may
          email this address again.
        </p>
      ),
      confirmLabel: "Remove from list",
      danger: true,
    });
    if (confirmed) run(() => removeSuppressionAction(pipeline, lead.id));
  }

  return (
    <div className="flex flex-col gap-4">
      {dialog}
      <section aria-labelledby="status-heading" className="card flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 id="status-heading" className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            Status
          </h2>
          <StatusBadge status={lead.status} />
        </div>
        {lead.replyNeedsReview && (
          <section aria-labelledby="reply-look-heading" className="notice-warning flex flex-col gap-2">
            <h3 id="reply-look-heading" className="font-semibold">
              Reply needs a look
            </h3>
            {latestReply?.text && (
              <figure className="flex flex-col gap-1">
                <blockquote className="whitespace-pre-line border-l-2 border-current pl-3 italic">{clipReply(latestReply.text)}</blockquote>
                <figcaption className="text-xs">Received {latestReply.receivedAt}</figcaption>
              </figure>
            )}
            <p>{lead.replyReviewReason ?? `A reply arrived while this lead was ${statusLabel(lead.status)}.`}</p>
            <p className="text-xs">
              Until you choose, nothing is emailed to this address
              {lead.status === "contacted" ? " and the lead stays in Contacted, off the call deck" : ""}
              {lead.status === "cold_call_list" ? " and the call deck shows this warning on the lead's card" : ""}.
            </p>
            <div className="flex flex-wrap gap-2">
              {showMarkReplied && (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => run(() => markRepliedAction(pipeline, lead.id))}
                  className="btn-secondary"
                >
                  Mark replied
                </button>
              )}
              {lead.email && !suppression && (
                <button type="button" disabled={isPending} onClick={optOut} className="btn-danger">
                  Mark opted out
                </button>
              )}
              <button type="button" disabled={isPending} onClick={keep} className="btn-secondary">
                Keep as {statusLabel(lead.status)}
              </button>
            </div>
          </section>
        )}
        {moves.length > 0 ? (
          <label className="field-label">
            Move to…
            <select
              value=""
              disabled={isPending}
              onChange={(e) => {
                if (e.target.value) void moveTo(e.target.value);
              }}
              className="input"
            >
              <option value="">Choose a stage</option>
              {moves.map((s) => (
                <option key={s} value={s}>
                  {isBackwardMove(lead.status, s) ? `← ${statusLabel(s)}` : statusLabel(s)}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="text-sm muted">No manual moves from {statusLabel(lead.status)}.</p>
        )}
      </section>

      <section aria-labelledby="email-heading" className="card flex flex-col gap-3 p-4">
        <h2 id="email-heading" className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          Email
        </h2>

        {suppression && (
          <div className="notice-error flex flex-col gap-2">
            <p>
              <strong>On the do-not-email list</strong> since {suppression.since}.{" "}
              {suppression.source === "inbound_reply" ? (
                <>
                  Their reply was read as an opt-out
                  {suppression.evidence ? (
                    <>
                      : <q className="font-medium">{suppression.evidence}</q>
                    </>
                  ) : (
                    "."
                  )}
                </>
              ) : suppression.source === "manual" ? (
                "Marked opted out by hand."
              ) : (
                (suppression.reason ?? "")
              )}
            </p>
            <button type="button" disabled={isPending} onClick={unsuppress} className="btn-secondary self-start">
              Remove from do-not-email list
            </button>
          </div>
        )}
        {!suppression && lead.sendBlockedReason && <p className="notice-warning">{lead.sendBlockedReason}</p>}
        {!suppression && needsAddressCheck && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => confirmAddressAction(pipeline, lead.id))}
            className="btn-secondary"
          >
            Address checked — allow sending
          </button>
        )}

        {!lead.email && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => findLeadEmailAction(pipeline, lead.id))}
            className="btn-secondary"
          >
            {isPending ? "Working…" : "Find email"}
          </button>
        )}

        {canSend && (
          <>
            <button type="button" disabled={isPending || paused} onClick={send} className="btn-primary">
              Send outreach email
            </button>
            {paused && <p className="text-sm muted">Outbound email is paused — resume it in Settings to send.</p>}
          </>
        )}
        {lead.email && !canSend && !suppression && !lead.sendBlockedReason && lead.status !== "new" && (
          <p className="text-sm muted">
            {lead.emailed
              ? "Already pitched — each lead gets one outreach email."
              : `The first pitch only goes to New leads; this one is ${statusLabel(lead.status)}.`}
          </p>
        )}

        {showMarkReplied && !lead.replyNeedsReview && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => markRepliedAction(pipeline, lead.id))}
            className="btn-secondary"
          >
            Mark replied
          </button>
        )}
        {lead.replied && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => setOurReplyAction(pipeline, lead.id, !lead.ourReplied))}
            className="btn-secondary"
          >
            {lead.ourReplied ? "Clear “we replied”" : "Mark “we replied”"}
          </button>
        )}
        {/* A reply read as an opt-out proves the email arrived, so there's no bounce to record. */}
        {lead.emailed && !lead.bounced && suppression?.source !== "inbound_reply" && (
          <button type="button" disabled={isPending} onClick={bounced} className="btn-danger">
            Mark bounced
          </button>
        )}
        {lead.email && !suppression && !lead.replyNeedsReview && (
          <button type="button" disabled={isPending} onClick={optOut} className="btn-danger">
            Mark opted out
          </button>
        )}

        <ActionMessage feedback={feedback} />
      </section>

      <section aria-labelledby="manage-heading" className="card flex flex-col gap-3 p-4">
        <h2 id="manage-heading" className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          Lead details
        </h2>
        <Link href={`${basePath}/${lead.id}/edit`} className="btn-secondary text-center">
          Edit details
        </Link>
        <button type="button" disabled={isPending} onClick={remove} className="btn-danger">
          Delete lead…
        </button>
      </section>
    </div>
  );
}
