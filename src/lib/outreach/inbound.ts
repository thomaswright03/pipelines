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
// A reply that isn't an opt-out but reads like a brush-off or complaint
// ("not interested", "wrong person" — see reply-classifier.ts) sets the
// reply time and flags the lead "Reply needs a look" with the reason,
// instead of moving it to Responded; the operator decides.
// An opt-out reply suppresses the address (from any status) and moves a
// lead we were working — Contacted, Responded, on the call deck — to Lost
// (Not interested in dataleadsell). New leads just become unsendable;
// customers keep their status.
//
// The reply's text is added to the lead's history (AgentLeadActivity /
// LeadActivity), never to its Notes, so it can't push the operator's notes
// past their limit.
//
// Everything happens in one transaction together with an InboundReply row,
// so a re-delivered reply is recognised and changes nothing, and a failure
// part-way leaves nothing half-recorded (the Worker retries — see README).
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { suppressEmail } from "@/lib/email-suppression";
import { formatDateTime } from "@/lib/time";
import { REPLY_FLAGS_FOR_REVIEW, REPLY_MOVES_TO_RESPONDED, statusLabel } from "@/lib/lead-status";
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
  /** Why the reply was flagged for a look instead of counted as a positive reply, if it was. */
  review: string | null;
  /** Leads the reply landed on that need a human look. */
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
export function extractEmailAddress(from: string): string {
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
  const note = replyNote(now, message.subject ?? null, replyText || null, classification);

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
          review: earlier.reviewReason,
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
          const flagged = await recordOnLead(tx, pipeline, lead, {
            optOut: classification.optOut,
            review: classification.review,
            fromEmail,
            note,
            now,
          });
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
          reviewReason: classification.review,
          matched,
          text: replyText || null,
          receivedAt: now,
        },
      });
      return {
        matched,
        optedOut: classification.optOut,
        trigger: classification.trigger,
        review: classification.review,
        needsReview,
        duplicate: false,
      };
    },
    { timeout: 20_000 },
  );
}

/** What a reply does to one lead's fields, given its current status. */
export function replyUpdateFor(
  pipelineId: PipelineAdapter["id"],
  lead: Pick<OutreachLead, "status" | "repliedAt">,
  reply: { optOut: boolean; review?: string | null; pitched: boolean; fromEmail: string; now: Date },
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
  if (reply.review && lead.status !== "new") {
    // Possibly a "no" or a complaint: the operator decides, the status stays.
    data.replyNeedsReview = true;
    data.replyReviewReason = `The reply ${reply.review}. It may be asking not to be emailed.`;
    return { data, needsReview: true };
  }
  if (REPLY_MOVES_TO_RESPONDED.includes(lead.status)) {
    data.status = "responded";
    return { data, needsReview: false };
  }
  if (REPLY_FLAGS_FOR_REVIEW.includes(lead.status)) {
    data.replyNeedsReview = true;
    data.replyReviewReason = `A reply arrived while this lead was ${statusLabel(lead.status)}.`;
    return { data, needsReview: true };
  }
  return { data, needsReview: false };
}

function replyNote(
  receivedAt: Date,
  subject: string | null,
  text: string | null,
  verdict: { optOut: boolean; trigger: string | null; review: string | null },
  from?: string,
): string {
  return [
    `Reply received ${formatDateTime(receivedAt)}${from ? ` from ${from}` : ""}${subject ? ` — ${subject}` : ""}`,
    text,
    verdict.optOut && verdict.trigger ? `→ Read as an opt-out because of: "${verdict.trigger}"` : null,
    !verdict.optOut && verdict.review ? `→ Flagged for a look: the reply ${verdict.review}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

// --- Replies that matched no lead ---------------------------------------
// A reply from an address no lead has (an assistant, a personal address, a
// forward) is kept with its text and listed in the app until the operator
// attaches it to the right lead — which applies the normal reply rules to
// that lead — or dismisses it.

export type UnmatchedReply = {
  id: string;
  fromEmail: string;
  subject: string | null;
  text: string | null;
  optedOut: boolean;
  receivedAt: Date;
};

const UNMATCHED = { matched: { isEmpty: true }, resolvedAt: null } as const;

export async function listUnmatchedReplies(take = 20): Promise<UnmatchedReply[]> {
  return prisma.inboundReply.findMany({
    where: UNMATCHED,
    orderBy: { receivedAt: "desc" },
    take,
    select: { id: true, fromEmail: true, subject: true, text: true, optedOut: true, receivedAt: true },
  });
}

export function countUnmatchedReplies(): Promise<number> {
  return prisma.inboundReply.count({ where: UNMATCHED });
}

/** When the last reply of any kind arrived, for "is reply tracking working?". */
export async function lastInboundReplyAt(): Promise<Date | null> {
  const last = await prisma.inboundReply.findFirst({ orderBy: { receivedAt: "desc" }, select: { receivedAt: true } });
  return last?.receivedAt ?? null;
}

export type AttachResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * Records an unmatched reply on a lead the operator picked, exactly as if
 * it had come from the lead's own address: reply time, status move, and —
 * for an opt-out — the lead's address goes on the do-not-email list too.
 */
export async function attachReplyToLead(replyId: string, pipelineId: PipelineAdapter["id"], leadId: string): Promise<AttachResult> {
  const pipeline = ALL_PIPELINES.find((p) => p.id === pipelineId)!;
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${INBOUND_LOCK_NAMESPACE}::int, hashtext(${replyId}))`;
      const reply = await tx.inboundReply.findUnique({ where: { id: replyId } });
      if (!reply) return { ok: false as const, error: "That reply no longer exists." };
      if (reply.resolvedAt || reply.matched.length > 0) {
        return { ok: false as const, error: "That reply was already dealt with — reload the page." };
      }
      const lead = await pipeline.findLead(tx, leadId);
      if (!lead) return { ok: false as const, error: "That lead no longer exists." };

      const trigger = reply.optedOut ? classifyReply({ subject: reply.subject, text: reply.text }).trigger : null;
      const verdict = { optOut: reply.optedOut, trigger, review: reply.optedOut ? null : reply.reviewReason };
      if (reply.optedOut && lead.email) {
        await suppressEmail(
          lead.email,
          {
            reason: `A reply from ${reply.fromEmail} about this lead asked not to be emailed`,
            source: "inbound_reply",
            evidence: trigger,
          },
          tx,
        );
      }
      const note = replyNote(reply.receivedAt, reply.subject, reply.text, verdict, reply.fromEmail);
      await recordOnLead(tx, pipeline, lead, {
        optOut: reply.optedOut,
        review: verdict.review,
        fromEmail: lead.email ?? reply.fromEmail,
        note,
        now: reply.receivedAt,
      });
      const key = `${pipeline.id}:${lead.id}`;
      await tx.inboundReply.update({
        where: { id: reply.id },
        data: { matched: [key], resolvedAt: new Date(), resolution: `attached:${key}` },
      });
      const after = await pipeline.findLead(tx, lead.id);
      return {
        ok: true as const,
        message: `Added the reply from ${reply.fromEmail} to ${lead.name}${after && after.status !== lead.status ? ` — moved to ${statusLabel(after.status)}` : ""}${reply.optedOut && lead.email ? `, and ${lead.email} is now on the do-not-email list` : ""}.`,
      };
    },
    { timeout: 20_000 },
  );
}

export async function dismissReply(replyId: string): Promise<AttachResult> {
  const { count } = await prisma.inboundReply.updateMany({
    where: { id: replyId, ...UNMATCHED },
    data: { resolvedAt: new Date(), resolution: "dismissed" },
  });
  return count === 1
    ? { ok: true, message: "Dismissed the reply." }
    : { ok: false, error: "That reply was already dealt with — reload the page." };
}

async function recordOnLead(
  tx: Db,
  pipeline: PipelineAdapter,
  initial: OutreachLead,
  reply: { optOut: boolean; review: string | null; fromEmail: string; note: string; now: Date },
): Promise<boolean> {
  // Contacted always means "was emailed" (only a send puts a lead there).
  const pitched =
    initial.status === "contacted" || initial.lastEmailedAt !== null || (await pipeline.hasBeenEmailed(tx, initial.id));
  let lead: OutreachLead | null = initial;

  // Conditional on the status just read, so a concurrent change (a manual
  // move, the stale-contacts job) is never overwritten: re-read and retry.
  for (let attempt = 0; lead && attempt < MAX_ATTEMPTS_PER_LEAD; attempt++) {
    const { data, needsReview } = replyUpdateFor(pipeline.id, lead, { ...reply, pitched });
    if (await pipeline.updateIfStatus(tx, lead.id, [lead.status], data)) {
      await pipeline.addActivity(tx, lead.id, { type: "email", notes: reply.note, date: reply.now });
      return needsReview;
    }
    lead = await pipeline.findLead(tx, lead.id);
  }
  throw new Error(`Lead ${initial.id} kept changing while a reply was being recorded`);
}
