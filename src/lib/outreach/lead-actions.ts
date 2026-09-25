// Manual lead actions shared by both pipelines. Each checks that it makes
// sense for the lead's current status (the server is the authority — the
// buttons merely mirror these rules) and returns a message saying exactly
// what changed.
import { prisma } from "@/lib/db";
import { getSuppression, suppressEmail, unsuppressEmail } from "@/lib/email-suppression";
import {
  allowedTransitions,
  canMarkReplied,
  COLD_CALL_OUTCOMES,
  coldCallResult,
  CUSTOMER_STATUSES,
  isStatusOf,
  statusLabel,
  type ColdCallOutcome,
} from "@/lib/lead-status";
import { formatDate } from "@/lib/time";
import { OPTED_OUT_BLOCK_PREFIX } from "@/lib/outreach/send";
import { ALL_PIPELINES, getPipeline, type OutreachLead } from "@/lib/outreach/pipelines";
import type { PipelineId } from "@/lib/outreach/pipeline-id";

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

const ok = (message: string): ActionResult => ({ ok: true, message });
const refuse = (error: string): ActionResult => ({ ok: false, error });

async function loadLead(pipelineId: PipelineId, leadId: string): Promise<OutreachLead | null> {
  return getPipeline(pipelineId).findLead(prisma, leadId);
}

const NOT_FOUND = refuse("This lead no longer exists — it may have been removed.");

export async function changeStatus(pipelineId: PipelineId, leadId: string, to: string): Promise<ActionResult> {
  if (!isStatusOf(pipelineId, to)) return refuse(`"${to}" isn't a status in this pipeline.`);
  const lead = await loadLead(pipelineId, leadId);
  if (!lead) return NOT_FOUND;
  if (lead.status === to) return ok(`${lead.name} is already ${statusLabel(to)}.`);
  if (!allowedTransitions(pipelineId, lead.status).includes(to)) {
    return refuse(`${lead.name} can't move from ${statusLabel(lead.status)} to ${statusLabel(to)}.`);
  }
  const pipeline = getPipeline(pipelineId);
  if (to === "contacted") {
    // Only as "undo Mark replied": Contacted always means "was emailed".
    if (!(await pipeline.hasBeenEmailed(prisma, leadId))) {
      return refuse(`${lead.name} was never emailed, so they can't go back to Contacted.`);
    }
    await pipeline.update(prisma, leadId, { status: to, repliedAt: null, ourReplyAt: null, replyNeedsReview: false });
  } else {
    // A deliberate move is the operator's review of any pending reply.
    await pipeline.update(prisma, leadId, { status: to, replyNeedsReview: false });
  }
  return ok(`Moved ${lead.name} from ${statusLabel(lead.status)} to ${statusLabel(to)}.`);
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
  if (!moved) return refuse(`${lead.name} changed status a moment ago — reload the page and try again.`);
  return ok(`Marked ${lead.name} as replied — moved from ${statusLabel(lead.status)} to Responded.`);
}

/** Clears the "Replied — needs review" flag once the operator has looked. */
export async function dismissReplyReview(pipelineId: PipelineId, leadId: string): Promise<ActionResult> {
  const lead = await loadLead(pipelineId, leadId);
  if (!lead) return NOT_FOUND;
  await getPipeline(pipelineId).update(prisma, leadId, { replyNeedsReview: false });
  return ok(`Marked the reply from ${lead.name} as reviewed — they stay ${statusLabel(lead.status)}.`);
}

export async function markBounced(pipelineId: PipelineId, leadId: string): Promise<ActionResult> {
  const pipeline = getPipeline(pipelineId);
  const lead = await loadLead(pipelineId, leadId);
  if (!lead) return NOT_FOUND;
  if (!["contacted", "responded"].includes(lead.status) || !(await pipeline.hasBeenEmailed(prisma, leadId))) {
    return refuse(`${lead.name} hasn't been emailed, so there's nothing to mark as bounced.`);
  }
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await pipeline.markLatestSendBounced(tx, leadId, now);
    await pipeline.update(tx, leadId, {
      status: "lost",
      ...(pipelineId === "cold-outreach" ? { callOutcome: "unable_to_contact" } : {}),
    });
  });
  return ok(`Marked ${lead.name} as bounced — moved to Lost.`);
}

export async function markOptedOut(pipelineId: PipelineId, leadId: string): Promise<ActionResult> {
  const lead = await loadLead(pipelineId, leadId);
  if (!lead) return NOT_FOUND;
  if (!lead.email) return refuse(`${lead.name} has no email address to opt out.`);
  const email = lead.email.toLowerCase();

  const keepStatus = CUSTOMER_STATUSES.includes(lead.status);
  const newStatus = pipelineId === "dataleadsell" ? "not_interested" : "lost";
  await prisma.$transaction(async (tx) => {
    await suppressEmail(email, { reason: "Marked opted out manually", source: "manual" }, tx);
    await getPipeline(pipelineId).update(tx, leadId, {
      sendBlockedReason: `${OPTED_OUT_BLOCK_PREFIX} — ${email} is on the suppression list.`,
      ...(keepStatus ? {} : { status: newStatus }),
    });
  });
  return ok(
    `Added ${email} to the do-not-email list${keepStatus ? "" : ` and moved ${lead.name} to ${statusLabel(newStatus)}`}.`,
  );
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

  const restore =
    suppression.source === "inbound_reply" && lead.repliedAt !== null && ["lost", "not_interested"].includes(lead.status);
  await prisma.$transaction(async (tx) => {
    await unsuppressEmail(email, tx);
    for (const pipeline of ALL_PIPELINES) {
      await pipeline.clearSendBlockedByPrefix(tx, email, OPTED_OUT_BLOCK_PREFIX);
    }
    if (restore) await getPipeline(pipelineId).update(tx, leadId, { status: "responded" });
  });
  return ok(`Removed ${email} from the do-not-email list${restore ? ` — ${lead.name} is back to Responded` : ""}.`);
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

export async function confirmColdCall(
  pipelineId: PipelineId,
  leadId: string,
  outcome: string,
  notes: string,
): Promise<ActionResult> {
  if (!(COLD_CALL_OUTCOMES as readonly string[]).includes(outcome)) return refuse("Pick a call outcome first.");
  const lead = await loadLead(pipelineId, leadId);
  if (!lead) return NOT_FOUND;
  if (lead.status !== "cold_call_list") {
    return refuse(`${lead.name} is no longer on the cold-call list (now ${statusLabel(lead.status)}).`);
  }
  const trimmed = notes.trim().slice(0, 2_000);
  const noteLine = trimmed ? `[Cold call ${formatDate(new Date())}]: ${trimmed}` : null;
  const result = coldCallResult(pipelineId, outcome as ColdCallOutcome);
  await getPipeline(pipelineId).update(prisma, leadId, {
    callOutcome: result.callOutcome,
    ...(result.status ? { status: result.status } : {}),
    ...(noteLine ? { notes: [lead.notes, noteLine].filter(Boolean).join("\n\n") } : {}),
  });
  return ok(
    result.status
      ? `Saved the call with ${lead.name} — moved to ${statusLabel(result.status)}.`
      : `Saved the call with ${lead.name} — they stay on the list for another try.`,
  );
}
