"use server";

// Unmatched replies: find the lead a reply belongs to, attach it (which
// applies the normal reply rules to that lead), or dismiss it.
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/log";
import { statusLabel } from "@/lib/lead-status";
import { ALL_PIPELINES } from "@/lib/outreach/pipelines";
import { parsePipelineId, PIPELINE_BASE_PATH } from "@/lib/outreach/pipeline-id";
import { attachReplyToLead, dismissReply } from "@/lib/outreach/inbound";
import type { ActionResult } from "@/lib/outreach/lead-actions";

export type LeadMatch = { pipeline: string; pipelineLabel: string; id: string; name: string; email: string | null; status: string };

export async function searchLeadsForReplyAction(query: string): Promise<{ ok: true; leads: LeadMatch[] } | { ok: false; error: string }> {
  const q = String(query ?? "").trim().slice(0, 100);
  if (q.length < 2) return { ok: true, leads: [] };
  try {
    const results = await Promise.all(
      ALL_PIPELINES.map(async (p) =>
        (await p.search(prisma, q, 6)).map((lead) => ({
          pipeline: p.id,
          pipelineLabel: p.label,
          id: lead.id,
          name: lead.name,
          email: lead.email,
          status: statusLabel(lead.status),
        })),
      ),
    );
    return { ok: true, leads: results.flat() };
  } catch (err) {
    logError("action.searchLeadsForReply", err);
    return { ok: false, error: "Couldn't search leads — try again in a moment." };
  }
}

function refreshAll() {
  revalidatePath("/replies");
  for (const base of Object.values(PIPELINE_BASE_PATH)) revalidatePath(base, "layout");
}

export async function attachReplyAction(replyId: string, pipeline: string, leadId: string): Promise<ActionResult> {
  try {
    const result = await attachReplyToLead(String(replyId), parsePipelineId(pipeline), String(leadId));
    refreshAll();
    return result;
  } catch (err) {
    logError("action.attachReply", err, { replyId, pipeline, leadId });
    return { ok: false, error: "Couldn't attach the reply — nothing was changed. Try again in a moment." };
  }
}

export async function dismissReplyAction(replyId: string): Promise<ActionResult> {
  try {
    const result = await dismissReply(String(replyId));
    refreshAll();
    return result;
  } catch (err) {
    logError("action.dismissReply", err, { replyId });
    return { ok: false, error: "Couldn't dismiss the reply — try again in a moment." };
  }
}
