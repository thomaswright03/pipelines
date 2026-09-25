// Records an inbound reply (POSTed by the Cloudflare Email Worker to
// /api/email-inbound) against whichever leads have that address, in both
// pipelines, and enforces a genuine opt-out.
//
// What a reply does to a lead that was pitched:
// - Contacted, Cold call list, Contactless list → Responded, reply time set
//   (a reply after the stale-contacts job moved the lead to phone outreach
//   still counts as a reply and takes the lead off the call deck).
// - Lost, Not interested → status kept, reply time set, and the lead is
//   flagged "Replied — needs review" (it may have got there by a bounce or
//   an old call outcome rather than a decision about this reply).
// - Any other status → reply time set if missing; status kept.
// An opt-out reply suppresses the address (from any status) and moves a
// lead we were working — Contacted, Responded, on the call deck — to Lost
// (Not interested in dataleadsell). New leads just become unsendable;
// customers keep their status.
//
// Everything happens in one transaction together with an InboundReply row,
// so a re-delivered reply is recognised and changes nothing, and a failure
// part-way leaves nothing half-recorded (the Worker retries — see README).
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { suppressEmail } from "@/lib/email-suppression";
import { formatDateTime } from "@/lib/time";
import { REPLY_FLAGS_FOR_REVIEW, REPLY_MOVES_TO_RESPONDED } from "@/lib/lead-status";
import { classifyReply } from "@/lib/outreach/reply-classifier";
import { OPTED_OUT_BLOCK_PREFIX } from "@/lib/outreach/send";
import { ALL_PIPELINES, type Db, type LeadUpdate, type OutreachLead, type PipelineAdapter } from "@/lib/outreach/pipelines";

export type InboundEmail = {
  from: string;
  subject?: string | null;
  text?: string | null;
  /** The email's Message-ID header, when the Worker forwards it (preferred for de-duplication). */
  messageId?: string | null;
};

export type InboundResult = {
  matched: string[];
  optedOut: boolean;
  trigger: string | null;
  /** Leads the reply landed on that need a human look (Lost / Not interested). */
  needsReview: string[];
  /** True when this reply was already recorded; nothing was changed. */
  duplicate: boolean;
};

/** Without a Message-ID, an identical reply within this window is treated as a re-delivery. */
export const HASH_DEDUPE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// Namespaces this module's advisory locks (send.ts uses 4242).
const INBOUND_LOCK_NAMESPACE = 4243;
const MAX_STORED_REPLY_CHARS = 2_000;
const MAX_ATTEMPTS_PER_LEAD = 3;

/** "Jane Smith <Jane@Example.com>" or "jane@example.com" → "jane@example.com". */
function extractEmailAddress(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return (match ? match[1]! : from).trim().toLowerCase();
}

/** The key a re-delivery of the same reply maps to. */
export function inboundDedupeKey(message: InboundEmail): string {
  const messageId = message.messageId?.trim().replace(/^<|>$/g, "");
  if (messageId) return `mid:${messageId}`;
  const normalize = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
  const digest = createHash("sha256")
    .update([extractEmailAddress(message.from), normalize(message.subject), normalize(message.text)].join("\n"))
    .digest("hex");
  return `hash:${digest}`;
}

export async function handleInboundReply(message: InboundEmail, now: Date = new Date()): Promise<InboundResult> {
  const fromEmail = extractEmailAddress(message.from);
  const classification = classifyReply({ subject: message.subject, text: message.text });
  const dedupeKey = inboundDedupeKey(message);

  const replyText = classification.newText.slice(0, MAX_STORED_REPLY_CHARS);
  const note = [
    `[Reply received ${formatDateTime(now)}]${message.subject ? ` ${message.subject}` : ""}`,
    replyText,
    classification.optOut ? `→ Read as an opt-out because of: "${classification.trigger}"` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return prisma.$transaction(
    async (tx) => {
      // Serialise concurrent deliveries of the same reply.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${INBOUND_LOCK_NAMESPACE}::int, hashtext(${dedupeKey}))`;
      const earlier = await tx.inboundReply.findFirst({
        where: {
          dedupeKey,
          ...(dedupeKey.startsWith("hash:") ? { receivedAt: { gte: new Date(now.getTime() - HASH_DEDUPE_WINDOW_MS) } } : {}),
        },
        orderBy: { receivedAt: "desc" },
      });
      if (earlier) {
        return {
          matched: earlier.matched,
          optedOut: earlier.optedOut,
          trigger: classification.trigger,
          needsReview: [],
          duplicate: true,
        };
      }

      if (classification.optOut) {
        await suppressEmail(
          fromEmail,
          { reason: "Replied asking not to be emailed", source: "inbound_reply", evidence: classification.trigger },
          tx,
        );
      }

      const matched: string[] = [];
      const needsReview: string[] = [];
      for (const pipeline of ALL_PIPELINES) {
        for (const lead of await pipeline.findLeadsByEmail(tx, fromEmail)) {
          const flagged = await recordOnLead(tx, pipeline, lead, { optOut: classification.optOut, fromEmail, note, now });
          matched.push(`${pipeline.id}:${lead.id}`);
          if (flagged) needsReview.push(`${pipeline.id}:${lead.id}`);
        }
      }

      await tx.inboundReply.create({
        data: {
          dedupeKey,
          fromEmail,
          subject: message.subject?.slice(0, 500) ?? null,
          optedOut: classification.optOut,
          matched,
          receivedAt: now,
        },
      });
      return { matched, optedOut: classification.optOut, trigger: classification.trigger, needsReview, duplicate: false };
    },
    { timeout: 20_000 },
  );
}

/** What a reply does to one lead's fields, given its current status. */
export function replyUpdateFor(
  pipelineId: PipelineAdapter["id"],
  lead: Pick<OutreachLead, "status" | "repliedAt">,
  reply: { optOut: boolean; pitched: boolean; fromEmail: string; now: Date },
): { data: LeadUpdate; needsReview: boolean } {
  const data: LeadUpdate = {};
  // Only a lead that was actually emailed counts toward the reply rate.
  if (reply.pitched && !lead.repliedAt) data.repliedAt = reply.now;

  if (reply.optOut) {
    data.sendBlockedReason = `${OPTED_OUT_BLOCK_PREFIX} — ${reply.fromEmail} is on the suppression list.`;
    // A lead we were actively working (emailing, or about to call) is done;
    // a New lead just can't be emailed, and a customer stays a customer.
    if (REPLY_MOVES_TO_RESPONDED.includes(lead.status) || lead.status === "responded") {
      data.status = pipelineId === "dataleadsell" ? "not_interested" : "lost";
    }
    return { data, needsReview: false };
  }

  if (!reply.pitched) return { data, needsReview: false };
  if (REPLY_MOVES_TO_RESPONDED.includes(lead.status)) {
    data.status = "responded";
    return { data, needsReview: false };
  }
  if (REPLY_FLAGS_FOR_REVIEW.includes(lead.status)) {
    data.replyNeedsReview = true;
    return { data, needsReview: true };
  }
  return { data, needsReview: false };
}

async function recordOnLead(
  tx: Db,
  pipeline: PipelineAdapter,
  initial: OutreachLead,
  reply: { optOut: boolean; fromEmail: string; note: string; now: Date },
): Promise<boolean> {
  // Contacted always means "was emailed" (only a send puts a lead there).
  const pitched =
    initial.status === "contacted" || initial.lastEmailedAt !== null || (await pipeline.hasBeenEmailed(tx, initial.id));
  let lead: OutreachLead | null = initial;

  // Conditional on the status just read, so a concurrent change (a manual
  // move, the stale-contacts job) is never overwritten: re-read and retry.
  for (let attempt = 0; lead && attempt < MAX_ATTEMPTS_PER_LEAD; attempt++) {
    const { data, needsReview } = replyUpdateFor(pipeline.id, lead, { ...reply, pitched });
    if (pipeline.id === "dataleadsell") data.notes = [lead.notes, reply.note].filter(Boolean).join("\n\n");
    if (await pipeline.updateIfStatus(tx, lead.id, [lead.status], data)) {
      if (pipeline.id === "cold-outreach") {
        await tx.leadActivity.create({ data: { leadId: lead.id, type: "email", notes: reply.note } });
      }
      return needsReview;
    }
    lead = await pipeline.findLead(tx, lead.id);
  }
  throw new Error(`Lead ${initial.id} kept changing while a reply was being recorded`);
}
