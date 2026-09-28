// Editing and deleting leads (both pipelines).
//
// The address is what the one-pitch rule is keyed on, so editing it is
// guarded the same way adding a lead is: an address held by another lead,
// already pitched, or on the do-not-email list is refused with a link to
// whoever holds it. A lead that has already been emailed keeps its address
// — the pitch went there, and changing it would hide that. Deleting a lead
// leaves its send history and its send-ledger entry in place, so its
// address is still never pitched again.
import { prisma } from "@/lib/db";
import { getSuppression } from "@/lib/email-suppression";
import { formatDate } from "@/lib/time";
import { findAddressConflict } from "@/lib/outreach/discovery";
import { ADDRESS_BLOCK_PREFIXES, UNVERIFIED_BLOCK_PREFIX } from "@/lib/outreach/send";
import { getPipeline } from "@/lib/outreach/pipelines";
import type { PipelineId } from "@/lib/outreach/pipeline-id";
import type { ActionResult } from "@/lib/outreach/lead-actions";
import { CHECKED_BY_HAND_PREFIX, ENTERED_BY_HAND_PREFIX, enteredByHandEvidence } from "@/lib/outreach/evidence";
import { recordCorrection } from "@/lib/outreach/corrections";

type AddressProblem = { message: string; link: { href: string; label: string } | null };

/** Why `email` can't be used for this (new or existing) lead, or null when it can. */
export async function checkAddressForLead(pipelineId: PipelineId, email: string, leadId?: string): Promise<AddressProblem | null> {
  const conflict = await findAddressConflict(pipelineId, email, leadId);
  if (conflict) {
    return {
      message: conflict.refused ? `${conflict.message}, so it can't be used.` : `${conflict.message} — each address gets one pitch.`,
      link: conflict.href ? { href: conflict.href, label: `Open ${conflict.leadName ?? "that lead"}` } : null,
    };
  }
  if (await getSuppression(email)) {
    return { message: `${email} is on the do-not-email list, so it can't be used for outreach.`, link: null };
  }
  return null;
}

/** Whether the lead has been pitched (by a finished send or one still in flight). */
export async function wasPitched(pipelineId: PipelineId, leadId: string, lastEmailedAt: Date | null): Promise<boolean> {
  if (lastEmailedAt) return true;
  if (await getPipeline(pipelineId).hasBeenEmailed(prisma, leadId)) return true;
  // A "refused" ledger entry means the mail server turned the address away:
  // nothing was delivered, so the address may still be corrected.
  return (await prisma.outreachRecipient.count({ where: { pipeline: pipelineId, leadId, state: { not: "refused" } } })) > 0;
}

type EditOutcome = { ok: true } | { ok: false; error: string; field?: "email"; link?: { href: string; label: string } | null };

/**
 * Saves edited contact details. `details` holds the pipeline's own columns
 * (already validated and normalised); `email` is handled here.
 */
export async function editLead(
  pipelineId: PipelineId,
  leadId: string,
  email: string | null,
  details: Record<string, unknown>,
): Promise<EditOutcome> {
  const pipeline = getPipeline(pipelineId);
  const lead = await pipeline.findLead(prisma, leadId);
  if (!lead) return { ok: false, error: "This lead no longer exists — it may have been deleted." };

  const newEmail = email ? email.trim().toLowerCase() : null;
  const data: Record<string, unknown> = { ...details };
  if (newEmail !== lead.email) {
    if (lead.email && (await wasPitched(pipelineId, leadId, lead.lastEmailedAt))) {
      return {
        ok: false,
        field: "email",
        error: `${lead.name} was already emailed at ${lead.email}, so the address can't be changed — the one pitch went there.`,
      };
    }
    if (newEmail) {
      const problem = await checkAddressForLead(pipelineId, newEmail, leadId);
      if (problem) return { ok: false, field: "email", error: problem.message, link: problem.link };
    }
    data.email = newEmail;
    data.emailEvidence = newEmail ? enteredByHandEvidence() : null;
    data.emailRulesVersion = null;
    // Failed attempts at the old address say nothing about the new one.
    data.lastSendFailedAt = null;
    data.lastSendFailure = null;
    data.sendRefusalCount = 0;
    // A block about the old address doesn't apply to the new one.
    if (lead.sendBlockedReason && ADDRESS_BLOCK_PREFIXES.some((p) => lead.sendBlockedReason!.startsWith(p))) {
      data.sendBlockedReason = null;
    }
  }

  const applied = await pipeline.updateIfUnchanged(prisma, leadId, { status: lead.status, email: lead.email }, data);
  if (!applied) {
    return { ok: false, error: `${lead.name} changed a moment ago (for example, it was just emailed) — reload the page and try again.` };
  }
  // Replacing an address the lookup found: a sign it picked the wrong one.
  if (newEmail !== lead.email && lead.email && lead.emailEvidence && !lead.emailEvidence.startsWith(ENTERED_BY_HAND_PREFIX)) {
    await recordCorrection(prisma, {
      kind: "address_corrected",
      pipeline: pipelineId,
      leadId,
      email: lead.email,
      detail: lead.emailEvidence,
      rulesVersion: lead.emailRulesVersion,
    });
  }
  return { ok: true };
}

/**
 * Lets an address held back by the "unverified address" check be sent,
 * once the operator has checked it belongs to the lead.
 */
export async function confirmAddress(pipelineId: PipelineId, leadId: string): Promise<ActionResult> {
  const pipeline = getPipeline(pipelineId);
  const lead = await pipeline.findLead(prisma, leadId);
  if (!lead) return { ok: false, error: "This lead no longer exists — it may have been deleted." };
  if (!lead.email || !lead.sendBlockedReason?.startsWith(UNVERIFIED_BLOCK_PREFIX)) {
    return { ok: false, error: `${lead.name}'s address isn't waiting to be checked.` };
  }
  const applied = await pipeline.updateIfUnchanged(
    prisma,
    leadId,
    { status: lead.status, email: lead.email },
    { sendBlockedReason: null, emailEvidence: `${CHECKED_BY_HAND_PREFIX} on ${formatDate(new Date())}.`, emailRulesVersion: null },
  );
  if (!applied) return { ok: false, error: `${lead.name} changed a moment ago — reload the page and try again.` };
  return { ok: true, message: `Marked ${lead.email} as checked — ${lead.name} can be emailed.` };
}

/** Deletes a lead; its send history and ledger entry stay, so its address is never re-pitched. */
export async function deleteLead(pipelineId: PipelineId, leadId: string): Promise<ActionResult> {
  const pipeline = getPipeline(pipelineId);
  const lead = await pipeline.findLead(prisma, leadId);
  if (!lead) return { ok: false, error: "This lead no longer exists — it may have been deleted already." };
  await pipeline.deleteLead(prisma, leadId);
  return { ok: true, message: `Deleted ${lead.name}.` };
}
