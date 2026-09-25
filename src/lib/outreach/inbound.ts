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
// Mail no person wrote is told apart first (auto-mail.ts):
// - An automatic reply (out-of-office, autoresponder) is added to the
//   lead's history, marked as automatic, and changes nothing else: status,
//   reply time and the reply rate are untouched, so the lead still moves to
//   phone outreach after a week. A real reply later counts as usual. One
//   that matches no lead is filed away rather than listed on Replies.
// - A bounce notice marks the failed recipient's latest send bounced, with
//   the same rules as "Mark bounced". One whose address can't be read, or
//   matches no lead, is listed on Replies as a bounce for the operator.
// An opt-out is checked before either, so an autoresponder that asks not
// to be emailed is still honoured.
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
import { classifyReply, REPLY_RULES_VERSION } from "@/lib/outreach/reply-classifier";
import { AUTO_MAIL_RULES_VERSION, detectAutoReply, detectBounce, type MailHeaders } from "@/lib/outreach/auto-mail";
import { applyBounce } from "@/lib/outreach/lead-actions";
import { OPTED_OUT_BLOCK_PREFIX } from "@/lib/outreach/send";
import { DATALEADSELL_SENDER_EMAIL } from "@/lib/dataleadsell-config";
import { VAULT_PIPELINE_SENDER_EMAIL } from "@/lib/vault-config";
import { ALL_PIPELINES, type Db, type LeadUpdate, type OutreachLead, type PipelineAdapter } from "@/lib/outreach/pipelines";

/** The rules behind every stored inbound verdict (kind, opt-out, review). */
export const INBOUND_RULES_VERSION = `${REPLY_RULES_VERSION} ${AUTO_MAIL_RULES_VERSION}`;

export type InboundEmail = {
  from: string;
  subject?: string | null;
  text?: string | null;
  /** The email's Message-ID header, when the Worker forwards it (preferred for de-duplication). */
  messageId?: string | null;
  /** The email's headers, when the Worker forwards them (used to recognise automatic replies and bounces). */
  headers?: MailHeaders | null;
};

export type InboundKind = "reply" | "auto_reply" | "bounce";

export type InboundResult = {
  /** A reply a person wrote, an automatic reply, or a bounce notice. */
  kind: InboundKind;
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
const HASH_DEDUPE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

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
function inboundDedupeKey(message: InboundEmail): string {
  const messageId = message.messageId?.trim().replace(/^<|>$/g, "");
  if (messageId) return `mid:${messageId}`;
  const normalize = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
  const digest = createHash("sha256")
    .update([extractEmailAddress(message.from), normalize(message.subject), normalize(message.text)].join("\n"))
    .digest("hex");
  return `hash:${digest}`;
}

const OWN_DOMAINS = [VAULT_PIPELINE_SENDER_EMAIL, DATALEADSELL_SENDER_EMAIL].map((address) => address.split("@")[1]!);

export async function handleInboundReply(message: InboundEmail, now: Date = new Date()): Promise<InboundResult> {
  const fromEmail = extractEmailAddress(message.from);
  const classification = classifyReply({ subject: message.subject, text: message.text });
  const dedupeKey = inboundDedupeKey(message);
  // A bounce is recognised on the raw text (DSN fields sit below what the
  // reply classifier would keep); an opt-out always wins over "automatic".
  const bounce = classification.optOut ? null : detectBounce({ ...message, from: fromEmail }, OWN_DOMAINS);
  const autoReason = classification.optOut || bounce ? null : detectAutoReply(message);
  const kind: InboundKind = bounce ? "bounce" : autoReason ? "auto_reply" : "reply";

  const replyText = (bounce ? (message.text ?? "").trim() : classification.newText).slice(0, MAX_STORED_REPLY_CHARS);
  const note =
    kind === "auto_reply"
      ? autoReplyNote(now, message.subject ?? null, replyText || null, autoReason!)
      : replyNote(now, message.subject ?? null, replyText || null, classification);

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
          kind: earlier.kind as InboundKind,
          matched: earlier.matched,
          optedOut: earlier.optedOut,
          trigger: classification.trigger,
          review: earlier.reviewReason,
          needsReview: [],
          duplicate: true,
        };
      }

      const matched: string[] = [];
      const needsReview: string[] = [];

      if (bounce) {
        if (bounce.failedRecipient) {
          for (const pipeline of ALL_PIPELINES) {
            for (const lead of await pipeline.findLeadsByEmail(tx, bounce.failedRecipient)) {
              if (!(await recordBounceOnLead(tx, pipeline, lead, bounce, now))) continue;
              matched.push(`${pipeline.id}:${lead.id}`);
            }
          }
        }
      } else {
        if (classification.optOut) {
          await suppressEmail(
            fromEmail,
            { reason: "Replied asking not to be emailed", source: "inbound_reply", evidence: classification.trigger },
            tx,
          );
        }
        for (const pipeline of ALL_PIPELINES) {
          for (const lead of await pipeline.findLeadsByEmail(tx, fromEmail)) {
            matched.push(`${pipeline.id}:${lead.id}`);
            if (kind === "auto_reply") {
              // History only: the lead is exactly where it was.
              await pipeline.addActivity(tx, lead.id, { type: "email", notes: note, date: now });
              continue;
            }
            const flagged = await recordOnLead(tx, pipeline, lead, {
              optOut: classification.optOut,
              review: classification.review,
              fromEmail,
              note,
              now,
            });
            if (flagged) needsReview.push(`${pipeline.id}:${lead.id}`);
          }
        }
      }

      await tx.inboundReply.create({
        data: {
          dedupeKey,
          fromEmail,
          subject: message.subject?.slice(0, 500) ?? null,
          optedOut: classification.optOut,
          reviewReason: kind === "reply" ? classification.review : null,
          kind,
          kindReason: bounce ? [bounce.reason, bounce.diagnostic].filter(Boolean).join(" — ") : autoReason,
          failedRecipient: bounce?.failedRecipient ?? null,
          rulesVersion: INBOUND_RULES_VERSION,
          matched,
          text: replyText || null,
          receivedAt: now,
          // An automatic reply from an address no lead has is nothing to act on.
          ...(kind === "auto_reply" && matched.length === 0 ? { resolvedAt: now, resolution: "auto_reply" } : {}),
        },
      });
      return {
        kind,
        matched,
        optedOut: classification.optOut,
        trigger: classification.trigger,
        review: kind === "reply" ? classification.review : null,
        needsReview,
        duplicate: false,
      };
    },
    { timeout: 20_000 },
  );
}

/**
 * Marks the lead's latest send bounced (only a lead that was emailed at
 * this address) and adds the notice to its history. Returns whether the
 * notice was recorded on this lead.
 */
async function recordBounceOnLead(
  tx: Db,
  pipeline: PipelineAdapter,
  lead: OutreachLead,
  bounce: { reason: string; diagnostic: string | null },
  now: Date,
): Promise<boolean> {
  if (!(await pipeline.hasBeenEmailed(tx, lead.id))) return false;
  const outcome = await applyBounce(tx, pipeline.id, lead, now);
  const effect = !outcome
    ? "The send was already marked bounced."
    : outcome.to !== outcome.from
      ? `Marked the email bounced — moved from ${statusLabel(outcome.from)} to ${statusLabel(outcome.to)}.`
      : `Marked the email bounced — status kept (${statusLabel(outcome.to)}).`;
  await pipeline.addActivity(tx, lead.id, {
    type: "email",
    notes: [`Bounce notice received ${formatDateTime(now)} (${bounce.reason})`, bounce.diagnostic, `→ ${effect}`].filter(Boolean).join("\n"),
    date: now,
  });
  return true;
}

/** What a reply does to one lead's fields, given its current status. */
function replyUpdateFor(
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

function autoReplyNote(receivedAt: Date, subject: string | null, text: string | null, reason: string): string {
  return [
    `Automatic reply received ${formatDateTime(receivedAt)}${subject ? ` — ${subject}` : ""}`,
    text,
    `→ Read as automatic because of the ${reason}, so the lead's status and reply time were left as they were. If a person wrote this, use "Mark replied".`,
  ]
    .filter(Boolean)
    .join("\n");
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
  kind: string;
  kindReason: string | null;
  failedRecipient: string | null;
  receivedAt: Date;
};

const UNMATCHED = { matched: { isEmpty: true }, resolvedAt: null } as const;

export async function listUnmatchedReplies(take = 20): Promise<UnmatchedReply[]> {
  return prisma.inboundReply.findMany({
    where: UNMATCHED,
    orderBy: { receivedAt: "desc" },
    take,
    select: {
      id: true,
      fromEmail: true,
      subject: true,
      text: true,
      optedOut: true,
      kind: true,
      kindReason: true,
      failedRecipient: true,
      receivedAt: true,
    },
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
      const key = `${pipeline.id}:${lead.id}`;

      if (reply.kind === "bounce") {
        // A bounce notice the address couldn't be read from: the operator
        // picked the lead whose email bounced.
        if (!(await pipeline.hasBeenEmailed(tx, lead.id))) {
          return { ok: false as const, error: `${lead.name} was never emailed, so this bounce can't be theirs.` };
        }
        await recordBounceOnLead(tx, pipeline, lead, { reason: reply.kindReason ?? "delivery-failure notice", diagnostic: null }, reply.receivedAt);
        await tx.inboundReply.update({
          where: { id: reply.id },
          data: { matched: [key], resolvedAt: new Date(), resolution: `bounced:${key}` },
        });
        const after = await pipeline.findLead(tx, lead.id);
        return {
          ok: true as const,
          message: `Marked the email to ${lead.name} as bounced${after && after.status !== lead.status ? ` — moved to ${statusLabel(after.status)}` : ""}.`,
        };
      }

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
