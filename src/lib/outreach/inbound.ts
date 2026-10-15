// Records an inbound reply (POSTed by the Cloudflare Email Worker to
// /api/email-inbound) against whichever leads have that address, in both
// pipelines, and enforces a genuine opt-out.
//
// The reply classifier (reply-classifier.ts) gives every reply one of five
// verdicts, and only a confident one acts on its own:
// - opt_out: the address is suppressed (from any status) and a lead we were
//   working — Contacted, Responded, on the call deck — moves to Lost (Not
//   interested in dataleadsell). New leads just become unsendable;
//   customers keep their status. The reply counts as a reply.
// - positive: the reply time is set and, on a lead that was pitched,
//   Contacted / Cold call list / Contactless list → Responded (a reply
//   after the stale-contacts job moved the lead to phone outreach still
//   counts and takes it off the call deck). Lost / Not interested keep their
//   status and are flagged "Replied — needs review" (they may have got there
//   by a bounce or an old call outcome). Other statuses keep theirs.
// - declined (a plain no): the reply time is set on a lead that was
//   pitched; a lead we were working — Contacted, or on the call deck —
//   moves to Lost / Not interested (call outcome "Not interested"); a lead
//   past that (Responded, an appointment, a customer) keeps its status and
//   is flagged for a look. It is not an opt-out: the address isn't
//   suppressed, but send.ts sends nothing more to it.
// - acknowledged (only "Thanks" / "Got it"): recorded in the lead's history
//   only — status and reply time stay as they were, so it doesn't count as
//   a reply, and a Contacted lead still moves to phone outreach after a
//   week. send.ts sends nothing more to the address.
// - needs_look: every lead with the address, in any pipeline and whatever
//   its status, is flagged "Reply needs a look" with the reason. Its status
//   and reply time stay as they were, so it neither counts toward the reply
//   rate nor leaves Contacted for the call deck, and send.ts sends nothing
//   to the address until the operator resolves the flag (Mark replied, Mark
//   opted out, a status move, or Keep as it is).
//
// Mail no person wrote is told apart first (auto-mail.ts):
// - An automatic reply (out-of-office, autoresponder) is added to the
//   lead's history, marked as automatic, and changes nothing else: status,
//   reply time and the reply rate are untouched, so the lead still moves to
//   phone outreach after a week. A real reply later counts as usual. One
//   that matches no lead is filed away rather than listed on Replies. A
//   message read as automatic only from its wording that also says yes or
//   "interested" ("I'm out this week, but yes — call me Monday") is treated
//   as a reply that needs a look instead.
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
// part-way leaves nothing half-recorded (the Worker retries — see docs/deployment.md).
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { suppressEmail } from "@/lib/email-suppression";
import { formatDateTime } from "@/lib/time";
import { declinedStatus, REPLY_FLAGS_FOR_REVIEW, REPLY_MOVES_TO_RESPONDED, statusLabel } from "@/lib/lead-status";
import { classifyReply, REPLY_RULES_VERSION, showsClearInterest, type ReplyVerdict } from "@/lib/outreach/reply-classifier";
import { AUTO_MAIL_RULES_VERSION, autoReplySignal, detectBounce, type MailHeaders } from "@/lib/outreach/auto-mail";
import { applyBounce } from "@/lib/outreach/lead-actions";
import { ANSWERED_BLOCK_PREFIX, OPTED_OUT_BLOCK_PREFIX } from "@/lib/outreach/send";
import { DATALEADSELL_SENDER_EMAIL } from "@/lib/dataleadsell-config";
import { VAULT_PIPELINE_SENDER_EMAIL } from "@/lib/vault-config";
import { GARBAGE_AI_SENDER_EMAIL } from "@/lib/garbage-ai-config";
import { ALL_PIPELINES, type Db, type LeadUpdate, type OutreachLead, type PipelineAdapter } from "@/lib/outreach/pipelines";

/** The rules behind every stored inbound verdict (kind, opt-out, review). */
export const INBOUND_RULES_VERSION = `${REPLY_RULES_VERSION} ${AUTO_MAIL_RULES_VERSION}`;

type InboundEmail = {
  from: string;
  subject?: string | null;
  text?: string | null;
  /** The email's Message-ID header, when the Worker forwards it (preferred for de-duplication). */
  messageId?: string | null;
  /** The email's headers, when the Worker forwards them (used to recognise automatic replies and bounces). */
  headers?: MailHeaders | null;
};

type InboundKind = "reply" | "auto_reply" | "bounce";

type InboundResult = {
  /** A reply a person wrote, an automatic reply, or a bounce notice. */
  kind: InboundKind;
  /** For a reply a person wrote: the classifier's verdict. */
  verdict: ReplyVerdict | null;
  matched: string[];
  optedOut: boolean;
  trigger: string | null;
  /** Why the reply was flagged for a look instead of counted as a positive reply, if it was. */
  review: string | null;
  /** Leads the reply landed on that need a human look. */
  needsReview: string[];
  /** True when this reply was already recorded; nothing was changed. */
  duplicate: boolean;
  /** The InboundReply row this reply is stored as. */
  replyId: string;
};

/** Without a Message-ID, an identical reply within this window is treated as a re-delivery. */
const HASH_DEDUPE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// Namespaces this module's advisory locks (address-lock.ts uses 4242).
const INBOUND_LOCK_NAMESPACE = 4243;
const MAX_STORED_REPLY_CHARS = 2_000;
const MAX_ATTEMPTS_PER_LEAD = 3;

const ADDRESS_RE = /[a-z0-9._%+'!#$&*=?^`{|}~-]+@(?:[a-z0-9-]+\.)+[a-z]{2,}/i;

/**
 * The sender's address, lowercased: "Jane Smith <Jane@Example.com>",
 * "jane@example.com" and "MAILER-DAEMON@mx.example.com (Mail Delivery
 * System)" all give the address. Null when `from` holds no address at all
 * (the route refuses such a message).
 */
export function extractEmailAddress(from: string): string | null {
  const bracketed = from.match(/<([^<>]*)>/)?.[1] ?? "";
  const match = ADDRESS_RE.exec(bracketed) ?? ADDRESS_RE.exec(from);
  return match ? match[0].toLowerCase() : null;
}

/** The key a re-delivery of the same reply maps to. */
function inboundDedupeKey(message: InboundEmail, fromEmail: string): string {
  const messageId = message.messageId?.trim().replace(/^<|>$/g, "");
  if (messageId) return `mid:${messageId}`;
  const normalize = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
  const digest = createHash("sha256")
    .update([fromEmail, normalize(message.subject), normalize(message.text)].join("\n"))
    .digest("hex");
  return `hash:${digest}`;
}

const OWN_DOMAINS = [VAULT_PIPELINE_SENDER_EMAIL, DATALEADSELL_SENDER_EMAIL, GARBAGE_AI_SENDER_EMAIL].map(
  (address) => address.split("@")[1]!,
);

export async function handleInboundReply(message: InboundEmail, now: Date = new Date()): Promise<InboundResult> {
  const fromEmail = extractEmailAddress(message.from);
  if (!fromEmail) throw new Error("handleInboundReply: `from` holds no email address (the route refuses these)");
  let classification = classifyReply({ subject: message.subject, text: message.text });
  const dedupeKey = inboundDedupeKey(message, fromEmail);
  // A bounce is recognised on the raw text (DSN fields sit below what the
  // reply classifier would keep); an opt-out always wins over "automatic".
  const bounce = classification.optOut ? null : detectBounce({ ...message, from: fromEmail }, OWN_DOMAINS);
  const auto = classification.optOut || bounce ? null : autoReplySignal(message);
  // Out-of-office wording alone, in a message that also says yes: a person
  // may have written it, so it isn't filed away as automatic.
  const autoButInterested = auto?.basis === "wording" && showsClearInterest(message.text ?? "");
  const autoReason = auto && !autoButInterested ? auto.reason : null;
  if (autoButInterested && classification.verdict === "positive") {
    classification = {
      ...classification,
      verdict: "needs_look",
      review: `It reads partly like an out-of-office message (${auto.reason}) but also says yes or interested — check it.`,
    };
  }
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
          verdict: (earlier.verdict as ReplyVerdict | null) ?? null,
          matched: earlier.matched,
          optedOut: earlier.optedOut,
          trigger: classification.trigger,
          review: earlier.reviewReason,
          needsReview: [],
          duplicate: true,
          replyId: earlier.id,
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
              verdict: classification.verdict,
              review: classification.review,
              declineReason: classification.declineReason,
              fromEmail,
              note,
              now,
            });
            if (flagged) needsReview.push(`${pipeline.id}:${lead.id}`);
          }
        }
      }

      const stored = await tx.inboundReply.create({
        data: {
          dedupeKey,
          fromEmail,
          subject: message.subject?.slice(0, 500) ?? null,
          optedOut: classification.optOut,
          reviewReason: kind === "reply" ? classification.review : null,
          verdict: kind === "reply" ? classification.verdict : null,
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
        verdict: kind === "reply" ? classification.verdict : null,
        matched,
        optedOut: classification.optOut,
        trigger: classification.trigger,
        review: kind === "reply" ? classification.review : null,
        needsReview,
        duplicate: false,
        replyId: stored.id,
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
    notes: [`Bounce notice received ${formatDateTime(now)} (${bounce.reason})`, bounce.diagnostic, `→ ${effect}`]
      .filter(Boolean)
      .join("\n"),
    date: now,
  });
  return true;
}

/** What a reply does to one lead's fields, given its verdict and the lead's current status. */
function replyUpdateFor(
  pipelineId: PipelineAdapter["id"],
  lead: Pick<OutreachLead, "status" | "repliedAt" | "sendBlockedReason">,
  reply: { verdict: ReplyVerdict; review: string | null; declineReason: string | null; pitched: boolean; fromEmail: string; now: Date },
): { data: LeadUpdate; needsReview: boolean } {
  const data: LeadUpdate = {};

  // A plain no or a courtesy note holds the address (send.ts); a New lead
  // with it says so on its page and drops out of bulk sends at once.
  const answered = reply.verdict === "declined" || reply.verdict === "acknowledged";
  if (answered && lead.status === "new" && !lead.sendBlockedReason) {
    data.sendBlockedReason = `${ANSWERED_BLOCK_PREFIX} — ${reply.fromEmail} already answered a pitch (a plain no or a courtesy note), so this lead is never auto-sent.`;
  }

  // Otherwise a courtesy note changes nothing on the lead.
  if (reply.verdict === "acknowledged") return { data, needsReview: false };

  if (reply.verdict === "needs_look") {
    // Not a reply, not an opt-out, until the operator decides. The flag also
    // holds every send to the address (send.ts) — whatever the lead's status.
    data.replyNeedsReview = true;
    data.replyReviewReason = reply.review ?? "The rules couldn't read this reply.";
    return { data, needsReview: true };
  }

  // Only a lead that was actually emailed counts toward the reply rate.
  if (reply.pitched && !lead.repliedAt) data.repliedAt = reply.now;

  if (reply.verdict === "opt_out") {
    data.sendBlockedReason = `${OPTED_OUT_BLOCK_PREFIX} — ${reply.fromEmail} is on the suppression list.`;
    data.replyNeedsReview = false;
    data.replyReviewReason = null;
    // A lead we were actively working (emailing, or about to call) is done;
    // a New lead just can't be emailed, and a customer stays a customer.
    if (REPLY_MOVES_TO_RESPONDED.includes(lead.status) || lead.status === "responded") {
      data.status = declinedStatus(pipelineId);
    }
    return { data, needsReview: false };
  }

  if (reply.verdict === "declined") {
    // A lead we were still trying to reach is closed, as a "not interested"
    // call outcome would; one that got further is left for the operator.
    if (REPLY_MOVES_TO_RESPONDED.includes(lead.status)) {
      data.status = declinedStatus(pipelineId);
      data.callOutcome = "not_interested";
      return { data, needsReview: false };
    }
    if (lead.status === "new" || REPLY_FLAGS_FOR_REVIEW.includes(lead.status)) return { data, needsReview: false };
    data.replyNeedsReview = true;
    data.replyReviewReason = `A reply ${reply.declineReason ?? "says no"} while this lead is ${statusLabel(lead.status)} — check whether to close it.`;
    return { data, needsReview: true };
  }

  if (!reply.pitched) return { data, needsReview: false };
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
  verdict: { verdict: ReplyVerdict; trigger: string | null; review: string | null; declineReason: string | null },
  from?: string,
): string {
  return [
    `Reply received ${formatDateTime(receivedAt)}${from ? ` from ${from}` : ""}${subject ? ` — ${subject}` : ""}`,
    text,
    verdict.verdict === "opt_out" && verdict.trigger ? `→ Read as an opt-out because of: "${verdict.trigger}"` : null,
    verdict.verdict === "needs_look"
      ? `→ Needs a look, so not counted as a reply or an opt-out yet, and nothing is emailed to this address until you resolve it. ${verdict.review ?? ""}`.trim()
      : null,
    verdict.verdict === "declined"
      ? `→ Read as a plain no: it ${verdict.declineReason ?? "says no"}${verdict.trigger ? ` ("${verdict.trigger}")` : ""}. A lead still being worked moves to Lost / Not interested, and nothing more is emailed to this address. It isn't treated as an opt-out; if it was misread, move the lead back to Responded.`
      : null,
    verdict.verdict === "acknowledged"
      ? `→ Read as a courtesy note only: not counted as a reply or an opt-out, and the lead stays where it was. Nothing more is emailed to this address. If they meant more, use "Mark replied".`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

// --- Replies that matched no lead ---------------------------------------
// A reply from an address no lead has (an assistant, a personal address, a
// forward) is kept with its text and listed in the app until the operator
// attaches it to the right lead — which applies the normal reply rules to
// that lead — or dismisses it.

type UnmatchedReply = {
  id: string;
  fromEmail: string;
  subject: string | null;
  text: string | null;
  optedOut: boolean;
  kind: string;
  kindReason: string | null;
  failedRecipient: string | null;
  /** Why the reply needs a look, when it does (nothing is emailed to the address until it's dealt with). */
  reviewReason: string | null;
  /** The classifier's verdict, for a reply a person wrote. */
  verdict: string | null;
  receivedAt: Date;
};

const UNMATCHED = { matched: { isEmpty: true }, resolvedAt: null } as const;

/** Unmatched replies the rules read as interested: a live prospect writing from another address. */
const UNMATCHED_INTERESTED = { ...UNMATCHED, kind: "reply", verdict: "positive" } as const;

const UNMATCHED_SELECT = {
  id: true,
  fromEmail: true,
  subject: true,
  text: true,
  optedOut: true,
  kind: true,
  kindReason: true,
  failedRecipient: true,
  reviewReason: true,
  verdict: true,
  receivedAt: true,
} as const;

/**
 * The latest `take` replies waiting to be matched to a lead: the ones read
 * as interested first (they are the most valuable, and easy to lose among
 * opt-outs and noise), then the rest, each group newest first.
 */
export async function listUnmatchedReplies(take = 20): Promise<UnmatchedReply[]> {
  const orderBy = { receivedAt: "desc" } as const;
  const interested = await prisma.inboundReply.findMany({ where: UNMATCHED_INTERESTED, orderBy, take, select: UNMATCHED_SELECT });
  if (interested.length >= take) return interested;
  const shown = new Set(interested.map((reply) => reply.id));
  const rest = await prisma.inboundReply.findMany({ where: UNMATCHED, orderBy, take, select: UNMATCHED_SELECT });
  return [...interested, ...rest.filter((reply) => !shown.has(reply.id)).slice(0, take - interested.length)];
}

export function countUnmatchedReplies(): Promise<number> {
  return prisma.inboundReply.count({ where: UNMATCHED });
}

/** How many of the replies waiting to be matched read as interested. */
export function countUnmatchedInterested(): Promise<number> {
  return prisma.inboundReply.count({ where: UNMATCHED_INTERESTED });
}

/** When the last reply of any kind arrived, for "is reply tracking working?". */
export async function lastInboundReplyAt(): Promise<Date | null> {
  const last = await prisma.inboundReply.findFirst({ orderBy: { receivedAt: "desc" }, select: { receivedAt: true } });
  return last?.receivedAt ?? null;
}

type AttachResult = { ok: true; message: string } | { ok: false; error: string };

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
        await recordBounceOnLead(
          tx,
          pipeline,
          lead,
          { reason: reply.kindReason ?? "delivery-failure notice", diagnostic: null },
          reply.receivedAt,
        );
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

      // The stored verdict stands (the rules may have changed since); the
      // stored text is what the classifier kept, so re-reading it recovers
      // an opt-out's or a decline's words. Rows from before verdicts were
      // stored imply theirs from the opt-out and review fields.
      const stored =
        (reply.verdict as ReplyVerdict | null) ?? (reply.optedOut ? "opt_out" : reply.reviewReason ? "needs_look" : "positive");
      const again = stored === "opt_out" || stored === "declined" ? classifyReply({ subject: reply.subject, text: reply.text }) : null;
      const verdict = {
        verdict: stored,
        trigger: again?.trigger ?? null,
        review: stored === "needs_look" ? reply.reviewReason : null,
        declineReason: stored === "declined" ? (again?.declineReason ?? null) : null,
      };
      if (reply.optedOut && lead.email) {
        await suppressEmail(
          lead.email,
          {
            reason: `A reply from ${reply.fromEmail} about this lead asked not to be emailed`,
            source: "inbound_reply",
            evidence: verdict.trigger,
          },
          tx,
        );
      }
      const note = replyNote(reply.receivedAt, reply.subject, reply.text, verdict, reply.fromEmail);
      await recordOnLead(tx, pipeline, lead, {
        verdict: verdict.verdict,
        review: verdict.review,
        declineReason: verdict.declineReason,
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

/**
 * The operator read an unmatched reply as a request not to be emailed: its
 * address goes on the do-not-email list (and every lead with it is flagged),
 * and the reply leaves the list.
 */
export async function optOutUnmatchedReply(replyId: string): Promise<AttachResult> {
  return prisma.$transaction(async (tx) => {
    const reply = await tx.inboundReply.findFirst({ where: { id: replyId, ...UNMATCHED } });
    if (!reply) return { ok: false as const, error: "That reply was already dealt with — reload the page." };
    await suppressEmail(
      reply.fromEmail,
      { reason: "A reply read by the operator as asking not to be emailed", source: "manual", evidence: reply.text?.slice(0, 300) ?? null },
      tx,
    );
    await tx.inboundReply.update({ where: { id: reply.id }, data: { resolvedAt: new Date(), resolution: "opted_out" } });
    return { ok: true as const, message: `Added ${reply.fromEmail} to the do-not-email list. No pipeline will email it.` };
  });
}

async function recordOnLead(
  tx: Db,
  pipeline: PipelineAdapter,
  initial: OutreachLead,
  reply: { verdict: ReplyVerdict; review: string | null; declineReason: string | null; fromEmail: string; note: string; now: Date },
): Promise<boolean> {
  // Contacted always means "was emailed" (only a send puts a lead there).
  const pitched = initial.status === "contacted" || initial.lastEmailedAt !== null || (await pipeline.hasBeenEmailed(tx, initial.id));
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
