"use server";

// Server actions shared by both pipelines' pages. Each validates its
// input, calls the shared rules in src/lib/outreach/, refreshes the pages
// that show the result, and turns unexpected failures into a plain message
// (the technical detail goes to the server log with the lead id).
import { failureMessage } from "@/lib/db-health";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/log";
import { parsePipelineId, PIPELINE_BASE_PATH, type PipelineId } from "@/lib/outreach/pipeline-id";
import { getPipeline } from "@/lib/outreach/pipelines";
import { previewBulkSend, sendBulkChunk, sendFirstTouch, type BulkChunkResult, type BulkPreview } from "@/lib/outreach/send";
import { findEmailForLead, findEmailsChunk, type BulkFindResult } from "@/lib/outreach/discovery";
import {
  addLeadActivity,
  changeStatus,
  confirmColdCall,
  dismissReplyReview,
  markBounced,
  markOptedOut,
  markReplied,
  removeSuppression,
  setOurReply,
  setStarred,
  type ActionResult,
} from "@/lib/outreach/lead-actions";
import { confirmAddress, deleteLead } from "@/lib/outreach/lead-edit";
import { statusLabel } from "@/lib/lead-status";

function refresh(pipeline: PipelineId, leadId?: string) {
  const base = PIPELINE_BASE_PATH[pipeline];
  revalidatePath(base);
  revalidatePath(`${base}/stats`);
  revalidatePath(`${base}/cold-call`);
  if (leadId) revalidatePath(`${base}/${leadId}`);
}

async function guarded(
  scope: string,
  pipelineRaw: unknown,
  leadId: string | undefined,
  fn: (pipeline: PipelineId) => Promise<ActionResult>,
): Promise<ActionResult> {
  let pipeline: PipelineId;
  try {
    pipeline = parsePipelineId(pipelineRaw);
  } catch {
    return { ok: false, error: "Unknown pipeline." };
  }
  try {
    const result = await fn(pipeline);
    refresh(pipeline, leadId);
    return result;
  } catch (err) {
    logError(`action.${scope}`, err, { pipeline, leadId });
    return { ok: false, error: failureMessage(err, "Something went wrong saving that — nothing was changed. Try again in a moment.") };
  }
}

export async function sendOutreachEmailAction(pipeline: string, leadId: string): Promise<ActionResult> {
  return guarded("sendOutreachEmail", pipeline, leadId, async (p) => {
    const outcome = await sendFirstTouch(p, leadId);
    if (outcome.ok) return { ok: true, message: outcome.warning ? `${outcome.message} ${outcome.warning}` : outcome.message };
    return { ok: false, error: outcome.message };
  });
}

export async function findLeadEmailAction(pipeline: string, leadId: string): Promise<ActionResult> {
  return guarded("findLeadEmail", pipeline, leadId, async (p) => {
    const lead = await getPipeline(p).findLead(prisma, leadId);
    if (!lead) return { ok: false, error: "This lead no longer exists." };
    const outcome = await findEmailForLead(p, lead);
    switch (outcome.kind) {
      case "found":
        return {
          ok: true,
          message: outcome.blockedReason
            ? `Found ${outcome.email}, but ${outcome.blockedReason.replace(/^[^—]+— /, "")}`
            : `Found ${outcome.email} for ${lead.name}.`,
        };
      case "refused":
        return { ok: false, error: outcome.reason };
      case "unreachable":
        return {
          ok: false,
          error: `Couldn't reach ${outcome.website ? outcome.website.replace(/^https?:\/\//, "") : "the website"} just now (it timed out or returned an error), so nothing was changed — ${lead.name} stays ${statusLabel(lead.status)}. Try again later.`,
        };
      case "none": {
        const unverified = outcome.unverified
          ? ` ${outcome.unverified.email} is on ${outcome.unverified.website}, but that site doesn't show ${lead.name}'s phone, street address or city, so it may be a different business and wasn't saved. If it is theirs, edit the lead and enter it.`
          : "";
        return {
          ok: false,
          error:
            (outcome.routedTo
              ? `No usable email found for ${lead.name} — moved to ${outcome.routedTo === "cold_call_list" ? "the call deck for phone outreach" : "“No phone number”, since there's no way to reach them yet"}.`
              : `No usable email found for ${lead.name}.`) + unverified,
        };
      }
    }
  });
}

/** Moves a lead from its page. A move to Lost needs `reason` (one of LOST_REASONS). */
export async function updateLeadStatusAction(pipeline: string, leadId: string, status: string, reason?: string): Promise<ActionResult> {
  return guarded("updateLeadStatus", pipeline, leadId, (p) => changeStatus(p, leadId, status, reason));
}

export async function markRepliedAction(pipeline: string, leadId: string): Promise<ActionResult> {
  return guarded("markReplied", pipeline, leadId, (p) => markReplied(p, leadId));
}

export async function dismissReplyReviewAction(pipeline: string, leadId: string): Promise<ActionResult> {
  return guarded("dismissReplyReview", pipeline, leadId, (p) => dismissReplyReview(p, leadId));
}

export async function markBouncedAction(pipeline: string, leadId: string): Promise<ActionResult> {
  return guarded("markBounced", pipeline, leadId, (p) => markBounced(p, leadId));
}

export async function markOptedOutAction(pipeline: string, leadId: string): Promise<ActionResult> {
  return guarded("markOptedOut", pipeline, leadId, (p) => markOptedOut(p, leadId));
}

export async function removeSuppressionAction(pipeline: string, leadId: string): Promise<ActionResult> {
  return guarded("removeSuppression", pipeline, leadId, (p) => removeSuppression(p, leadId));
}

export async function confirmAddressAction(pipeline: string, leadId: string): Promise<ActionResult> {
  return guarded("confirmAddress", pipeline, leadId, (p) => confirmAddress(p, leadId));
}

export async function deleteLeadAction(pipeline: string, leadId: string): Promise<ActionResult> {
  return guarded("deleteLead", pipeline, undefined, (p) => deleteLead(p, leadId));
}

export async function setStarredAction(pipeline: string, leadId: string, starred: boolean): Promise<ActionResult> {
  return guarded("setStarred", pipeline, leadId, (p) => setStarred(p, leadId, Boolean(starred)));
}

export async function setOurReplyAction(pipeline: string, leadId: string, replied: boolean): Promise<ActionResult> {
  return guarded("setOurReply", pipeline, leadId, (p) => setOurReply(p, leadId, Boolean(replied)));
}

export async function confirmColdCallAction(pipeline: string, leadId: string, outcome: string, notes: string): Promise<ActionResult> {
  return guarded("confirmColdCall", pipeline, leadId, (p) => confirmColdCall(p, leadId, outcome, String(notes ?? "")));
}

// --- Bulk operations (the client loops over these to show progress) ---

export type BulkPreviewResult = { ok: true; preview: BulkPreview } | { ok: false; error: string };

export async function previewBulkSendAction(pipeline: string): Promise<BulkPreviewResult> {
  try {
    return { ok: true, preview: await previewBulkSend(parsePipelineId(pipeline)) };
  } catch (err) {
    logError("action.previewBulkSend", err, { pipeline });
    return { ok: false, error: failureMessage(err, "Couldn't work out who would be emailed — nothing was sent. Try again in a moment.") };
  }
}

export type BulkChunkActionResult = { ok: true; result: BulkChunkResult } | { ok: false; error: string };

export async function sendBulkChunkAction(pipeline: string, leadIds: string[], consecutiveFailures = 0): Promise<BulkChunkActionResult> {
  let p: PipelineId;
  try {
    p = parsePipelineId(pipeline);
  } catch {
    return { ok: false, error: "Unknown pipeline." };
  }
  try {
    const ids = Array.isArray(leadIds) ? leadIds.filter((id): id is string => typeof id === "string") : [];
    const result = await sendBulkChunk(p, ids, { consecutiveFailures: Number(consecutiveFailures) || 0 });
    // No revalidation per chunk: that re-rendered the whole list page into
    // every one-email response. The dialog shows progress, and the browser
    // refreshes the page once when the send ends (BulkSendButton).
    return { ok: true, result };
  } catch (err) {
    logError("action.sendBulkChunk", err, { pipeline });
    refresh(p);
    return {
      ok: false,
      error: failureMessage(err, "The bulk send stopped because of an unexpected error. Leads already emailed are marked Contacted."),
    };
  }
}

export type BulkFindActionResult = { ok: true; result: BulkFindResult } | { ok: false; error: string };

export async function findEmailsChunkAction(pipeline: string): Promise<BulkFindActionResult> {
  let p: PipelineId;
  try {
    p = parsePipelineId(pipeline);
  } catch {
    return { ok: false, error: "Unknown pipeline." };
  }
  try {
    const result = await findEmailsChunk(p);
    refresh(p);
    return { ok: true, result };
  } catch (err) {
    logError("action.findEmailsChunk", err, { pipeline });
    return { ok: false, error: failureMessage(err, "The email search stopped because of an unexpected error. Progress so far is saved.") };
  }
}

export async function addLeadActivityAction(pipeline: string, leadId: string, type: string, notes: string): Promise<ActionResult> {
  return guarded("addLeadActivity", pipeline, leadId, (p) => addLeadActivity(p, leadId, String(type), String(notes ?? "")));
}
