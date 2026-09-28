// Manual lead actions shared by both pipelines. Each checks that it makes
// sense for the lead's current status (the server is the authority — the
// buttons merely mirror these rules) and returns a message saying exactly
// what changed.
import { prisma } from "@/lib/db";
import { getSuppression, suppressEmail, unsuppressEmail } from "@/lib/email-suppression";
import {
  allowedTransitions,
  CALL_OUTCOME_LABEL,
  canMarkReplied,
  COLD_CALL_OUTCOME_LABEL,
  COLD_CALL_OUTCOMES,
  coldCallResult,
  CUSTOMER_STATUSES,
  isLostReason,
  isStatusOf,
  statusLabel,
  type ColdCallOutcome,
} from "@/lib/lead-status";
import { OPTED_OUT_BLOCK_PREFIX } from "@/lib/outreach/send";
import { ACTIVITY_TYPES, ALL_PIPELINES, getPipeline, type ActivityType, type Db, type OutreachLead } from "@/lib/outreach/pipelines";
import { recordCorrection } from "@/lib/outreach/corrections";
import { ENTERED_BY_HAND_PREFIX } from "@/lib/outreach/evidence";
import type { PipelineId } from "@/lib/outreach/pipeline-id";

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

const ok = (message: string): ActionResult => ({ ok: true, message });
const refuse = (error: string): ActionResult => ({ ok: false, error });

async function loadLead(pipelineId: PipelineId, leadId: string): Promise<OutreachLead | null> {
  return getPipeline(pipelineId).findLead(prisma, leadId);
}

const NOT_FOUND = refuse("This lead no longer exists — it may have been removed.");
const changedMeanwhile = (name: string) =>
  refuse(`${name} changed status a moment ago (a reply or an automatic move) — reload the page to see it, then try again.`);

/**
 * A manual move from the lead page. A move to Lost needs a reason (one of
 * LOST_REASONS), kept on the lead as its outcome.
 */
export async function changeStatus(pipelineId: PipelineId, leadId: string, to: string, reason?: string): Promise<ActionResult> {
  if (!isStatusOf(pipelineId, to)) return refuse(`"${to}" isn't a status in this pipeline.`);
  const lead = await loadLead(pipelineId, leadId);
  if (!lead) return NOT_FOUND;
  if (lead.status === to) return ok(`${lead.name} is already ${statusLabel(to)}.`);
  if (!allowedTransitions(pipelineId, lead.status).includes(to)) {
    return refuse(`${lead.name} can't move from ${statusLabel(lead.status)} to ${statusLabel(to)}.`);
  }
  if (to === "lost" && !isLostReason(reason)) return refuse(`Pick why ${lead.name} was lost first.`);
  const pipeline = getPipeline(pipelineId);
  if (to === "contacted") {
    // Only as "undo Mark replied": Contacted always means "was emailed".
    if (!(await pipeline.hasBeenEmailed(prisma, leadId))) {
      return refuse(`${lead.name} was never emailed, so they can't go back to Contacted.`);
    }
    const moved = await pipeline.updateIfStatus(prisma, leadId, [lead.status], {
      status: to,
      repliedAt: null,
      ourReplyAt: null,
      replyNeedsReview: false,
      replyReviewReason: null,
    });
    if (!moved) return changedMeanwhile(lead.name);
  } else {
    // A deliberate move is the operator's review of any pending reply.
    const moved = await pipeline.updateIfStatus(prisma, leadId, [lead.status], {
      status: to,
      replyNeedsReview: false,
      replyReviewReason: null,
      ...(to === "lost" ? { callOutcome: reason } : {}),
    });
    if (!moved) return changedMeanwhile(lead.name);
    // Reopening a lead a reply closed as a plain no: the reply rules misread it.
    if (to === "responded" && (lead.status === "lost" || lead.status === "not_interested")) {
      await recordReplyCorrection(pipelineId, lead, "declined", "decline_reversed");
    }
  }
  const why = to === "lost" && reason ? ` (${CALL_OUTCOME_LABEL[reason]})` : "";
  return ok(`Moved ${lead.name} from ${statusLabel(lead.status)} to ${statusLabel(to)}${why}.`);
}

export async function markReplied(pipelineId: PipelineId, leadId: string): Promise<ActionResult> {
  const pipeline = getPipeline(pipelineId);
  const lead = await loadLead(pipelineId, leadId);
  if (!lead) return NOT_FOUND;
  if (!canMarkReplied(lead.status)) {
    return refuse(`${lead.name} is ${statusLabel(lead.status)} — only a lead waiting on a reply can be marked replied.`);
  }
  if (lead.status !== "contacted" && !(await pipeline.hasBeenEmailed(prisma, leadId))) {
    return refuse(`${lead.name} was never emailed, so there's no email reply to record.`);
  }
  const moved = await pipeline.updateIfStatus(prisma, leadId, [lead.status], {
    repliedAt: lead.repliedAt ?? new Date(),
    status: "responded",
    replyNeedsReview: false,
  });
  if (!moved) return changedMeanwhile(lead.name);
  // Counting a reply the rules read as only a thank-you: they missed interest.
  await recordReplyCorrection(pipelineId, lead, "acknowledged", "courtesy_was_reply");
  return ok(`Marked ${lead.name} as replied — moved from ${statusLabel(lead.status)} to Responded.`);
}

/**
 * Records that the operator overrode a reply verdict, when the lead's latest
 * reply had `verdict`: the production signal for how the reply rules do.
 */
async function recordReplyCorrection(
  pipelineId: PipelineId,
  lead: OutreachLead,
  verdict: "declined" | "acknowledged",
  kind: "decline_reversed" | "courtesy_was_reply",
): Promise<void> {
  const latest = await prisma.inboundReply.findFirst({
    where: { matched: { has: `${pipelineId}:${lead.id}` }, kind: "reply" },
    orderBy: { receivedAt: "desc" },
    select: { verdict: true, text: true, rulesVersion: true },
  });
  if (latest?.verdict !== verdict) return;
  await recordCorrection(prisma, {
    kind,
    pipeline: pipelineId,
    leadId: lead.id,
    email: lead.email,
    detail: latest.text,
    rulesVersion: latest.rulesVersion,
  });
}

/** Clears the "Replied — needs review" flag once the operator has looked. */
export async function dismissReplyReview(pipelineId: PipelineId, leadId: string): Promise<ActionResult> {
  const lead = await loadLead(pipelineId, leadId);
  if (!lead) return NOT_FOUND;
  await getPipeline(pipelineId).update(prisma, leadId, { replyNeedsReview: false, replyReviewReason: null });
  return ok(`Marked the reply from ${lead.name} as reviewed — they stay ${statusLabel(lead.status)}.`);
}

/**
 * Records that the pitch to this lead bounced. Allowed for any lead that
 * was actually emailed, whatever its status now — a bounce is often
 * noticed after the stale-contacts job has already moved the lead to phone
 * outreach. A lead we were still working moves to Lost; one that has since
 * become a customer (or was already closed) keeps its status.
 */
export async function markBounced(pipelineId: PipelineId, leadId: string): Promise<ActionResult> {
  const pipeline = getPipeline(pipelineId);
  const lead = await loadLead(pipelineId, leadId);
  if (!lead) return NOT_FOUND;
  if (!(await pipeline.hasBeenEmailed(prisma, leadId))) {
    return refuse(`${lead.name} hasn't been emailed, so there's nothing to mark as bounced.`);
  }
  const outcome = await prisma.$transaction((tx) => applyBounce(tx, pipelineId, lead, new Date()));
  if (!outcome) return refuse(`The email to ${lead.name} is already marked as bounced.`);
  return ok(
    outcome.to !== outcome.from
      ? `Marked ${lead.name} as bounced — moved from ${statusLabel(outcome.from)} to ${statusLabel(outcome.to)}.`
      : `Marked the email to ${lead.name} as bounced — they stay ${statusLabel(outcome.to)}.`,
  );
}

// Statuses a bounce ends outreach for: we were still trying to reach them.
const BOUNCE_MOVES_TO_LOST: readonly string[] = ["contacted", "responded", "cold_call_list", "contactless_list"];

/**
 * The bounce rules shared by "Mark bounced" and bounce notices arriving on
 * the reply inbox (inbound.ts): the latest send is marked bounced, and a
 * lead we were still working moves to Lost. Returns null when there was no
 * unbounced send to mark (nothing is changed then), otherwise the lead's
 * status before and after. The status move is conditional on the status
 * just read, so a concurrent change is never overwritten — the lead is
 * re-read and the rule applied to its new status.
 */
export async function applyBounce(
  tx: Db,
  pipelineId: PipelineId,
  initial: OutreachLead,
  at: Date,
): Promise<{ from: string; to: string } | null> {
  const pipeline = getPipeline(pipelineId);
  if (!(await pipeline.markLatestSendBounced(tx, initial.id, at))) return null;
  await recordCorrectionIfFound(tx, pipelineId, initial);
  let lead: OutreachLead | null = initial;
  for (let attempt = 0; lead && attempt < 3; attempt++) {
    if (!BOUNCE_MOVES_TO_LOST.includes(lead.status)) return { from: initial.status, to: lead.status };
    const lost = { status: "lost", ...(pipelineId === "cold-outreach" ? { callOutcome: "unable_to_contact" } : {}) };
    if (await pipeline.updateIfStatus(tx, lead.id, [lead.status], lost)) return { from: initial.status, to: "lost" };
    lead = await pipeline.findLead(tx, lead.id);
  }
  throw new Error(`Lead ${initial.id} kept changing while a bounce was being recorded`);
}

/** A bounce on an address the lookup found (not one typed in) is a wrong-address signal for the email finder. */
async function recordCorrectionIfFound(tx: Db, pipelineId: PipelineId, lead: OutreachLead) {
  if (!lead.email || !lead.emailEvidence || lead.emailEvidence.startsWith(ENTERED_BY_HAND_PREFIX)) return;
  await recordCorrection(tx, {
    kind: "wrong_address",
    pipeline: pipelineId,
    leadId: lead.id,
    email: lead.email,
    detail: lead.emailEvidence,
    rulesVersion: lead.emailRulesVersion,
  });
}

export async function markOptedOut(pipelineId: PipelineId, leadId: string): Promise<ActionResult> {
  const lead = await loadLead(pipelineId, leadId);
  if (!lead) return NOT_FOUND;
  if (!lead.email) return refuse(`${lead.name} has no email address to opt out.`);
  const email = lead.email.toLowerCase();

  const keepStatus = CUSTOMER_STATUSES.includes(lead.status);
  const newStatus = pipelineId === "dataleadsell" ? "not_interested" : "lost";
  const block = {
    sendBlockedReason: `${OPTED_OUT_BLOCK_PREFIX} — ${email} is on the suppression list.`,
    replyNeedsReview: false,
    replyReviewReason: null,
  };
  const pipeline = getPipeline(pipelineId);
  // A reply from this lead that was recorded but not read as an opt-out:
  // the classifier missed one.
  const missedReply =
    (await getSuppression(email)) === null
      ? await prisma.inboundReply.findFirst({
          where: { optedOut: false, matched: { has: `${pipelineId}:${leadId}` } },
          orderBy: { receivedAt: "desc" },
          select: { text: true, subject: true },
        })
      : null;
  // The opt-out itself always applies; the status move only if nothing
  // moved the lead since the page was loaded.
  const moved = await prisma.$transaction(async (tx) => {
    await suppressEmail(email, { reason: "Marked opted out manually", source: "manual" }, tx);
    if (missedReply) {
      await recordCorrection(tx, {
        kind: "opt_out_missed",
        pipeline: pipelineId,
        leadId,
        email,
        detail: missedReply.text ?? missedReply.subject,
      });
    }
    if (keepStatus) {
      await pipeline.update(tx, leadId, block);
      return true;
    }
    if (await pipeline.updateIfStatus(tx, leadId, [lead.status], { ...block, status: newStatus })) return true;
    await pipeline.update(tx, leadId, block);
    return false;
  });
  if (!moved) {
    return ok(
      `Added ${email} to the do-not-email list. ${lead.name}'s status changed a moment ago, so it was left as it is — reload the page to see it.`,
    );
  }
  return ok(`Added ${email} to the do-not-email list${keepStatus ? "" : ` and moved ${lead.name} to ${statusLabel(newStatus)}`}.`);
}

/**
 * Reverses an opt-out that was recorded by mistake (e.g. a reply that was
 * misread). Clears the do-not-email entry and the "opted out" flag on every
 * lead with that address; if the opt-out came from a reply, the lead goes
 * back to Responded.
 */
export async function removeSuppression(pipelineId: PipelineId, leadId: string): Promise<ActionResult> {
  const lead = await loadLead(pipelineId, leadId);
  if (!lead) return NOT_FOUND;
  if (!lead.email) return refuse(`${lead.name} has no email address.`);
  const email = lead.email.toLowerCase();
  const suppression = await getSuppression(email);
  if (!suppression) return refuse(`${email} isn't on the do-not-email list.`);

  const restore = suppression.source === "inbound_reply" && lead.repliedAt !== null && ["lost", "not_interested"].includes(lead.status);
  await prisma.$transaction(async (tx) => {
    await unsuppressEmail(email, tx);
    for (const pipeline of ALL_PIPELINES) {
      await pipeline.clearSendBlockedByPrefix(tx, email, OPTED_OUT_BLOCK_PREFIX);
    }
    if (suppression.source === "inbound_reply") {
      await recordCorrection(tx, { kind: "opt_out_reversed", pipeline: pipelineId, leadId, email, detail: suppression.evidence });
    }
    if (restore) await getPipeline(pipelineId).updateIfStatus(tx, leadId, [lead.status], { status: "responded" });
  });
  return ok(`Removed ${email} from the do-not-email list${restore ? ` — ${lead.name} is back to Responded` : ""}.`);
}

/**
 * Adds an address to the do-not-email list from Settings (someone asked by
 * phone, a complaint…). Every lead with the address is flagged too.
 */
export async function addSuppression(rawEmail: string, note: string): Promise<ActionResult> {
  const email = rawEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return refuse("Enter a full email address, like name@business.com.");
  }
  if (await getSuppression(email)) return refuse(`${email} is already on the do-not-email list.`);
  const reason = note.trim().slice(0, 300) || "Added by hand in Settings";
  await prisma.$transaction(async (tx) => {
    await suppressEmail(email, { reason, source: "manual", evidence: note.trim().slice(0, 300) || null }, tx);
    for (const pipeline of ALL_PIPELINES) {
      for (const lead of await pipeline.findLeadsByEmail(tx, email)) {
        if (!lead.sendBlockedReason) {
          await pipeline.update(tx, lead.id, { sendBlockedReason: `${OPTED_OUT_BLOCK_PREFIX} — ${email} is on the suppression list.` });
        }
      }
    }
  });
  return ok(`Added ${email} to the do-not-email list. Neither pipeline will email it.`);
}

/**
 * Removes an address from the do-not-email list from Settings — for an
 * entry added by mistake. Leads keep their status (move them from the lead
 * page if needed); their "opted out" flag is cleared.
 */
export async function removeSuppressionByEmail(rawEmail: string): Promise<ActionResult> {
  const email = rawEmail.trim().toLowerCase();
  const suppression = await getSuppression(email);
  if (!suppression) return refuse(`${email} isn't on the do-not-email list.`);
  await prisma.$transaction(async (tx) => {
    await unsuppressEmail(email, tx);
    if (suppression.source === "inbound_reply") {
      await recordCorrection(tx, { kind: "opt_out_reversed", email, detail: suppression.evidence });
    }
    for (const pipeline of ALL_PIPELINES) {
      await pipeline.clearSendBlockedByPrefix(tx, email, OPTED_OUT_BLOCK_PREFIX);
    }
  });
  return ok(`Removed ${email} from the do-not-email list. Both pipelines may email it again.`);
}

export async function setStarred(pipelineId: PipelineId, leadId: string, starred: boolean): Promise<ActionResult> {
  const lead = await loadLead(pipelineId, leadId);
  if (!lead) return NOT_FOUND;
  await getPipeline(pipelineId).update(prisma, leadId, { starred });
  return ok(starred ? `Starred ${lead.name}.` : `Unstarred ${lead.name}.`);
}

export async function setOurReply(pipelineId: PipelineId, leadId: string, replied: boolean): Promise<ActionResult> {
  const lead = await loadLead(pipelineId, leadId);
  if (!lead) return NOT_FOUND;
  if (replied && !lead.repliedAt) return refuse(`${lead.name} hasn't replied yet, so there's nothing to answer.`);
  await getPipeline(pipelineId).update(prisma, leadId, { ourReplyAt: replied ? new Date() : null });
  return ok(replied ? `Recorded that you replied to ${lead.name}.` : `Cleared "we replied" for ${lead.name}.`);
}

export async function confirmColdCall(pipelineId: PipelineId, leadId: string, outcome: string, notes: string): Promise<ActionResult> {
  if (!(COLD_CALL_OUTCOMES as readonly string[]).includes(outcome)) return refuse("Pick a call outcome first.");
  const lead = await loadLead(pipelineId, leadId);
  if (!lead) return NOT_FOUND;
  if (lead.status !== "cold_call_list") {
    return refuse(`${lead.name} is no longer on the cold-call list (now ${statusLabel(lead.status)}).`);
  }
  const trimmed = notes.trim().slice(0, 2_000);
  const result = coldCallResult(pipelineId, outcome as ColdCallOutcome);
  const pipeline = getPipeline(pipelineId);
  // The call goes into the lead's history, not its Notes, so call notes
  // never count against the operator's notes limit.
  const entry = `Cold call — ${COLD_CALL_OUTCOME_LABEL[outcome as ColdCallOutcome]}${trimmed ? `: ${trimmed}` : ""}`;
  const saved = await prisma.$transaction(async (tx) => {
    const applied = await pipeline.updateIfStatus(tx, leadId, ["cold_call_list"], {
      callOutcome: result.callOutcome,
      ...(result.status ? { status: result.status } : {}),
    });
    if (applied) await pipeline.addActivity(tx, leadId, { type: "call", notes: entry });
    return applied;
  });
  if (!saved) return changedMeanwhile(lead.name);
  return ok(
    result.status
      ? `Saved the call with ${lead.name} — moved to ${statusLabel(result.status)}.`
      : `Saved the call with ${lead.name} — they stay on the list for another try.`,
  );
}

const MAX_ACTIVITY_CHARS = 2_000;

/** Logs a call, email, meeting or note in the lead's history. */
export async function addLeadActivity(pipelineId: PipelineId, leadId: string, type: string, notes: string): Promise<ActionResult> {
  const trimmed = String(notes ?? "").trim();
  if (!trimmed) return refuse("Write what happened first.");
  if (trimmed.length > MAX_ACTIVITY_CHARS) return refuse("Keep a history entry under 2,000 characters.");
  if (!(ACTIVITY_TYPES as readonly string[]).includes(type)) return refuse("Pick an entry type.");
  const lead = await loadLead(pipelineId, leadId);
  if (!lead) return NOT_FOUND;
  await getPipeline(pipelineId).addActivity(prisma, leadId, { type: type as ActivityType, notes: trimmed });
  return ok(`Added to ${lead.name}'s history.`);
}
