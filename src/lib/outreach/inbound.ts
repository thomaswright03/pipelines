// Records an inbound reply (POSTed by the Cloudflare Email Worker to
// /api/email-inbound) against whichever leads have that address, in both
// pipelines, and enforces a genuine opt-out.
import { prisma } from "@/lib/db";
import { suppressEmail } from "@/lib/email-suppression";
import { formatDateTime } from "@/lib/time";
import { classifyReply } from "@/lib/outreach/reply-classifier";
import { OPTED_OUT_BLOCK_PREFIX } from "@/lib/outreach/send";
import { ALL_PIPELINES, type LeadUpdate } from "@/lib/outreach/pipelines";

export type InboundEmail = { from: string; subject?: string | null; text?: string | null };
export type InboundResult = { matched: string[]; optedOut: boolean; trigger: string | null };

/** "Jane Smith <Jane@Example.com>" or "jane@example.com" → "jane@example.com". */
function extractEmailAddress(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return (match ? match[1]! : from).trim().toLowerCase();
}

const MAX_STORED_REPLY_CHARS = 2_000;

export async function handleInboundReply(message: InboundEmail): Promise<InboundResult> {
  const fromEmail = extractEmailAddress(message.from);
  const classification = classifyReply({ subject: message.subject, text: message.text });
  const now = new Date();

  if (classification.optOut) {
    await suppressEmail(fromEmail, {
      reason: "Replied asking not to be emailed",
      source: "inbound_reply",
      evidence: classification.trigger,
    });
  }

  const replyText = classification.newText.slice(0, MAX_STORED_REPLY_CHARS);
  const note = [
    `[Reply received ${formatDateTime(now)}]${message.subject ? ` ${message.subject}` : ""}`,
    replyText,
    classification.optOut ? `→ Read as an opt-out because of: "${classification.trigger}"` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const matched: string[] = [];
  for (const pipeline of ALL_PIPELINES) {
    const leads = await pipeline.findLeadsByEmail(prisma, fromEmail);
    for (const lead of leads) {
      const data: LeadUpdate = {};
      if (lead.status === "contacted") {
        data.repliedAt = now;
        data.status = classification.optOut ? (pipeline.id === "dataleadsell" ? "not_interested" : "lost") : "responded";
      }
      if (classification.optOut) {
        data.sendBlockedReason = `${OPTED_OUT_BLOCK_PREFIX} — ${fromEmail} is on the suppression list.`;
      }
      if (pipeline.id === "dataleadsell") {
        data.notes = [lead.notes, note].filter(Boolean).join("\n\n");
      } else {
        await prisma.leadActivity.create({ data: { leadId: lead.id, type: "email", notes: note } });
      }
      await pipeline.update(prisma, lead.id, data);
      matched.push(`${pipeline.id}:${lead.id}`);
    }
  }

  return { matched, optedOut: classification.optOut, trigger: classification.trigger };
}
