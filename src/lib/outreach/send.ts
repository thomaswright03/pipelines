// The one place outreach email gets sent from — single sends, bulk sends
// and the daily cron all come through sendFirstTouch(). The rules:
//
// - Only a lead in "new" with an address and no block flag gets the
//   first-touch pitch.
// - Nothing is sent while outbound email is paused (Settings, or the
//   OUTBOUND_EMAIL_DISABLED environment variable).
// - Nothing is sent to a suppressed (opted-out) address.
// - Nothing is sent to an address whose reply is waiting for the operator
//   ("Reply needs a look", on any lead in either pipeline, or unmatched on
//   the Replies page): the reply may be asking not to be emailed.
// - Nothing is sent to an address that already answered with a plain no or
//   only a courtesy note ("declined" / "acknowledged" replies): no look is
//   needed, and no more cold email goes to it either.
// - Each address gets at most one pitch per pipeline — and, unless the
//   owner allows it in Settings, at most one pitch across both pipelines.
// - The lead and the address are claimed atomically *before* the SMTP call
//   (a per-address advisory lock serialises concurrent claims), so
//   overlapping bulk runs, a cron run and a manual click can't double-send,
//   and a crash after sending leaves the claim in place so the lead is never
//   pitched again.
import { prisma } from "@/lib/db";
import { logError, logWarn } from "@/lib/log";
import { classifySendError, sendOutreachEmail } from "@/lib/send-email";
import { getAppSettings, pausedMessage, recordSendFailure } from "@/lib/outreach/settings";
import { ALL_PIPELINES, getPipeline, type Db, type OutreachLead } from "@/lib/outreach/pipelines";
import { PIPELINE_LABEL, type PipelineId } from "@/lib/outreach/pipeline-id";
import { statusLabel } from "@/lib/lead-status";
import { HOLDING_VERDICTS } from "@/lib/outreach/reply-classifier";
import { formatDate } from "@/lib/time";

// An arbitrary constant namespacing this app's advisory locks.
const ADDRESS_LOCK_NAMESPACE = 4242;

export const DUPLICATE_BLOCK_PREFIX = "Duplicate address";
export const OPTED_OUT_BLOCK_PREFIX = "Opted out";
/** Set by the migration on addresses the old, unchecked website guess found. */
export const UNVERIFIED_BLOCK_PREFIX = "Unverified address";
/** The recipient's mail server refused the address for good (e.g. 550 user unknown). */
export const REFUSED_BLOCK_PREFIX = "Address refused by the mail server";
/** The address already answered a pitch with a plain no or a courtesy note. */
export const ANSWERED_BLOCK_PREFIX = "Already answered";
/** Blocks that are about the lead's current address, so they end when the address changes. */
export const ADDRESS_BLOCK_PREFIXES = [
  DUPLICATE_BLOCK_PREFIX,
  OPTED_OUT_BLOCK_PREFIX,
  UNVERIFIED_BLOCK_PREFIX,
  REFUSED_BLOCK_PREFIX,
  ANSWERED_BLOCK_PREFIX,
];
/**
 * Temporary refusals (4xx: mailbox full, greylisting) of one address after
 * which it is treated like a permanent refusal, so it can't hold up every
 * send and daily run indefinitely.
 */
export const MAX_TEMPORARY_REFUSALS = 3;

type SendRefusal =
  | "paused"
  | "not_found"
  | "no_email"
  | "not_new"
  | "blocked"
  | "suppressed"
  | "duplicate_address"
  /** The recipient's mail server refused the address (now, or on an earlier send). */
  | "address_refused"
  /** A reply from this address is waiting for the operator to read it. */
  | "reply_needs_look"
  /** This address already answered with a plain no or a courtesy note. */
  | "already_answered";

type SendOutcome =
  | { ok: true; leadId: string; leadName: string; email: string; message: string; warning?: string }
  | {
      ok: false;
      leadId: string;
      leadName: string | null;
      reason: SendRefusal | "send_failed" | "delivery_unknown";
      message: string;
    };

class Refusal extends Error {
  constructor(
    readonly reason: SendRefusal,
    message: string,
  ) {
    super(message);
  }
}

/** Who already holds this address's pitch, if anyone (honouring the cross-pipeline setting). */
export async function findExistingPitch(
  db: Db,
  pipeline: PipelineId,
  email: string,
  allowCrossPipelineRepeats: boolean,
): Promise<{ pipeline: PipelineId; leadId: string | null; leadName: string | null; refused: boolean } | null> {
  const row = await db.outreachRecipient.findFirst({
    where: { email, ...(allowCrossPipelineRepeats ? { pipeline } : {}) },
    orderBy: { claimedAt: "asc" },
  });
  if (!row) return null;
  const other = row.pipeline as PipelineId;
  const lead = row.leadId ? await getPipeline(other).findLead(db, row.leadId) : null;
  return { pipeline: other, leadId: row.leadId, leadName: lead?.name ?? null, refused: row.state === "refused" };
}

/** Why a reply from an address holds every send to it. */
export type ReplyHold =
  /** A reply waiting for the operator: on a lead ("on Jane's page in Cold Outreach") or on the Replies page. */
  | { kind: "needs_look"; where: string }
  /** A plain no or a courtesy note: nothing more is sent, and nobody needs to look. */
  | { kind: "answered"; verdict: string; text: string | null; receivedAt: Date };

/**
 * What holds sends to each of `emails` (lower-case), if anything: a lead
 * flagged "Reply needs a look" in either pipeline, a reply on the Replies
 * page that matched no lead and needs a look, or a reply that said no or
 * only thanks (not dismissed from the Replies page).
 */
export async function replyHolds(db: Db, emails: string[]): Promise<Map<string, ReplyHold>> {
  const holds = new Map<string, ReplyHold>();
  if (emails.length === 0) return holds;
  for (const pipeline of ALL_PIPELINES) {
    for (const flagged of await pipeline.findReplyFlagged(db, emails)) {
      if (!holds.has(flagged.email))
        holds.set(flagged.email, { kind: "needs_look", where: `on ${flagged.name}'s page in ${pipeline.label}` });
    }
  }
  const [unmatched, answered] = await Promise.all([
    db.inboundReply.findMany({
      where: { fromEmail: { in: emails }, kind: "reply", reviewReason: { not: null }, matched: { isEmpty: true }, resolvedAt: null },
      select: { fromEmail: true },
    }),
    db.inboundReply.findMany({
      where: {
        fromEmail: { in: emails },
        verdict: { in: [...HOLDING_VERDICTS] },
        OR: [{ resolution: null }, { resolution: { not: "dismissed" } }],
      },
      orderBy: { receivedAt: "desc" },
      select: { fromEmail: true, verdict: true, text: true, receivedAt: true },
    }),
  ]);
  for (const row of unmatched)
    if (!holds.has(row.fromEmail)) holds.set(row.fromEmail, { kind: "needs_look", where: "on the Replies page" });
  for (const row of answered) {
    if (!holds.has(row.fromEmail)) {
      holds.set(row.fromEmail, { kind: "answered", verdict: row.verdict!, text: row.text, receivedAt: row.receivedAt });
    }
  }
  return holds;
}

/** How a send refused for an answered address explains it: "said no (“Not interested.”) on Sep 26, 2026". */
function describeAnswer(hold: Extract<ReplyHold, { kind: "answered" }>): string {
  const words = hold.text ? hold.text.replace(/\s+/g, " ").trim() : "";
  const quote = words ? ` (“${words.length > 60 ? `${words.slice(0, 60)}…` : words}”)` : "";
  return `${hold.verdict === "declined" ? "said no" : "sent a courtesy reply"}${quote} on ${formatDate(hold.receivedAt)}`;
}

function describeExistingPitch(existing: { pipeline: PipelineId; leadName: string | null }, self: PipelineId): string {
  const via = existing.leadName ? `via ${existing.leadName}` : "earlier";
  return existing.pipeline === self ? via : `${via} in ${PIPELINE_LABEL[existing.pipeline]}`;
}

async function lockAddress(tx: Db, email: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADDRESS_LOCK_NAMESPACE}::int, hashtext(${email}))`;
}

/**
 * Sends the first-touch pitch to one lead, enforcing every rule above.
 * Never throws for an expected refusal or send failure — the outcome says
 * what happened in words fit for the operator.
 */
export async function sendFirstTouch(pipelineId: PipelineId, leadId: string): Promise<SendOutcome> {
  const pipeline = getPipeline(pipelineId);
  const lead = await pipeline.findLead(prisma, leadId);
  if (!lead) return { ok: false, leadId, leadName: null, reason: "not_found", message: "This lead no longer exists." };
  const fail = (reason: SendRefusal | "send_failed" | "delivery_unknown", message: string): SendOutcome => ({
    ok: false,
    leadId,
    leadName: lead.name,
    reason,
    message,
  });

  if (!lead.email) return fail("no_email", `${lead.name} has no email address yet — nothing was sent.`);
  const email = lead.email.trim().toLowerCase();
  if (lead.status !== "new") {
    return fail(
      "not_new",
      `${lead.name} is ${statusLabel(lead.status)}, not New — the first pitch only goes to New leads. Nothing was sent.`,
    );
  }
  if (lead.sendBlockedReason) return fail("blocked", `${lead.name} isn't sendable: ${lead.sendBlockedReason}`);
  if (lead.replyNeedsReview) {
    return fail(
      "reply_needs_look",
      `A reply from ${lead.name} needs a look — nothing was sent. Read it on the lead's page and resolve it first.`,
    );
  }

  const claimedAt = new Date();
  let recipientId: string;
  try {
    recipientId = await prisma.$transaction(async (tx) => {
      await lockAddress(tx, email);
      const settings = await getAppSettings(tx);
      if (settings.outboundPaused) throw new Refusal("paused", pausedMessage(settings));

      if (await tx.suppressedEmail.findUnique({ where: { email } })) {
        throw new Refusal("suppressed", `${email} opted out of our emails — nothing was sent.`);
      }
      const hold = (await replyHolds(tx, [email])).get(email);
      if (hold?.kind === "needs_look") {
        throw new Refusal(
          "reply_needs_look",
          `A reply from ${email} is waiting for a look ${hold.where} — nothing was sent to ${lead.name}. Resolve that reply first.`,
        );
      }
      if (hold?.kind === "answered") {
        throw new Refusal(
          "already_answered",
          `${email} already ${describeAnswer(hold)}, so no more email goes to it — nothing was sent to ${lead.name}.`,
        );
      }

      const existing = await findExistingPitch(tx, pipelineId, email, settings.allowCrossPipelineRepeats);
      if (existing?.refused) {
        throw new Refusal(
          "address_refused",
          `The mail server refused ${email} on an earlier send — nothing was sent, and ${lead.name} won't be auto-sent.`,
        );
      }
      if (existing && existing.pipeline === pipelineId && existing.leadId === leadId) {
        const current = await pipeline.findLead(tx, leadId);
        if (current && current.status !== "new") {
          // This very lead holds the claim: another tab or a bulk send got
          // there first. Not a duplicate address — nothing to flag.
          throw new Refusal("not_new", `${lead.name} was just emailed from another tab or send — nothing more was sent.`);
        }
        // Pitched earlier and since moved back to New by hand: never again.
        throw new Refusal(
          "duplicate_address",
          `${email} was already pitched to ${lead.name} earlier — nothing was sent, and ${lead.name} won't be auto-sent.`,
        );
      }
      if (existing) {
        throw new Refusal(
          "duplicate_address",
          `${email} was already pitched ${describeExistingPitch(existing, pipelineId)} — nothing was sent, and ${lead.name} won't be auto-sent.`,
        );
      }

      if (!(await pipeline.claimForSend(tx, leadId, email, claimedAt))) {
        throw new Refusal("not_new", `${lead.name} was just emailed from another tab or send — nothing more was sent.`);
      }
      const recipient = await tx.outreachRecipient.create({
        data: { pipeline: pipelineId, email, leadId, state: "claimed", claimedAt },
      });
      return recipient.id;
    });
  } catch (err) {
    if (err instanceof Refusal) {
      await flagIfPermanent(pipelineId, lead, err);
      return fail(err.reason, err.message);
    }
    throw err;
  }

  const pitch = pipeline.buildEmail(lead);
  const { subject, body } = pitch;
  let providerMessageId: string;
  try {
    ({ providerMessageId } = await sendOutreachEmail(pipeline.senderEmail, email, subject, body));
  } catch (err) {
    const failure = classifySendError(err);
    logError("outreach.send", err, { pipeline: pipelineId, leadId, delivery: failure.delivery, scope: failure.scope });
    // Settings → Connections reports the email service itself; a refusal of
    // one recipient says nothing about it and is shown on that lead instead.
    if (failure.scope === "service") await recordSendFailure(failure.message);
    const failedAt = new Date();

    if (failure.delivery === "unknown") {
      await prisma.outreachRecipient.update({
        where: { id: recipientId },
        data: { state: "unknown", lastError: failure.message },
      });
      await recordAttempt(pipelineId, leadId, failedAt, failure.message, {});
      return fail("delivery_unknown", failure.message);
    }

    if (failure.scope === "service") {
      await prisma.$transaction(async (tx) => {
        await tx.outreachRecipient.delete({ where: { id: recipientId } });
        await pipeline.releaseClaim(tx, leadId, claimedAt, { lastEmailedAt: lead.lastEmailedAt, repliedAt: lead.repliedAt });
      });
      await recordAttempt(pipelineId, leadId, failedAt, failure.message, {});
      return fail("send_failed", failure.message);
    }

    // The recipient's server refused the address. A permanent refusal, or
    // the last of a few temporary ones, keeps the ledger entry (as
    // "refused", so the address is never tried again, from any lead) and
    // flags the lead; otherwise the lead stays sendable for a later try.
    const refusals = lead.sendRefusalCount + 1;
    const giveUp = failure.permanent || refusals >= MAX_TEMPORARY_REFUSALS;
    const message = giveUp
      ? `${failure.message} ${lead.name} won't be emailed at ${email}.`
      : `${failure.message} It will be tried again on a later send (${refusals} of ${MAX_TEMPORARY_REFUSALS} tries).`;
    const blockReason = giveUp
      ? `${REFUSED_BLOCK_PREFIX} — ${email} ${failure.permanent ? "can't receive email" : `was turned away ${refusals} times`}, so this lead is never auto-sent. Change the address to try another.`
      : null;
    await prisma.$transaction(async (tx) => {
      if (giveUp) {
        await tx.outreachRecipient.update({ where: { id: recipientId }, data: { state: "refused", lastError: failure.message } });
      } else {
        await tx.outreachRecipient.delete({ where: { id: recipientId } });
      }
      await pipeline.releaseClaim(tx, leadId, claimedAt, { lastEmailedAt: lead.lastEmailedAt, repliedAt: lead.repliedAt });
    });
    await recordAttempt(pipelineId, leadId, failedAt, message, {
      sendRefusalCount: refusals,
      ...(blockReason ? { sendBlockedReason: blockReason } : {}),
    });
    return fail("address_refused", message);
  }

  const sentAt = new Date();
  try {
    await prisma.$transaction(async (tx) => {
      await tx.outreachRecipient.update({
        where: { id: recipientId },
        data: { state: "sent", sentAt, providerMessageId },
      });
      await pipeline.recordSend(tx, leadId, email, providerMessageId, sentAt, pitch);
    });
  } catch (err) {
    // The email went out and the claim stands, so the lead can't be
    // pitched again — only the send-history row is missing.
    logError("outreach.send.record", err, { pipeline: pipelineId, leadId });
    return {
      ok: true,
      leadId,
      leadName: lead.name,
      email,
      message: `Sent the pitch to ${lead.name} (${email}).`,
      warning: "The email went out, but saving it to the send history failed.",
    };
  }
  return { ok: true, leadId, leadName: lead.name, email, message: `Sent the pitch to ${lead.name} (${email}) — moved to Contacted.` };
}

/**
 * Leaves a trace of a failed send attempt on the lead: an entry in its
 * History and the "last send failed" marker on the lead list. Best-effort
 * (the lead may have been deleted meanwhile): the send's outcome stands
 * either way.
 */
async function recordAttempt(
  pipelineId: PipelineId,
  leadId: string,
  at: Date,
  message: string,
  extra: { sendRefusalCount?: number; sendBlockedReason?: string },
): Promise<void> {
  const pipeline = getPipeline(pipelineId);
  try {
    await prisma.$transaction(async (tx) => {
      await pipeline.update(tx, leadId, { lastSendFailedAt: at, lastSendFailure: message.slice(0, 500), ...extra });
      await pipeline.addActivity(tx, leadId, { type: "email", notes: `Send attempt failed: ${message}`, date: at });
    });
  } catch (err) {
    logWarn("outreach.send.attempt", `couldn't record the failed attempt: ${String(err)}`, { pipeline: pipelineId, leadId });
  }
}

async function flagIfPermanent(pipelineId: PipelineId, lead: OutreachLead, refusal: Refusal): Promise<void> {
  const email = lead.email?.toLowerCase();
  let reason: string | null = null;
  if (refusal.reason === "duplicate_address") {
    reason = `${DUPLICATE_BLOCK_PREFIX} — ${email} was already pitched, so this lead is never auto-sent.`;
  } else if (refusal.reason === "suppressed") {
    reason = `${OPTED_OUT_BLOCK_PREFIX} — ${email} is on the suppression list.`;
  } else if (refusal.reason === "already_answered") {
    reason = `${ANSWERED_BLOCK_PREFIX} — ${email} already answered a pitch (a plain no or a courtesy note), so this lead is never auto-sent.`;
  } else if (refusal.reason === "address_refused") {
    reason = `${REFUSED_BLOCK_PREFIX} — the mail server refused ${email} on an earlier send, so this lead is never auto-sent. Change the address to try another.`;
  }
  if (!reason) return;
  try {
    await getPipeline(pipelineId).update(prisma, lead.id, { sendBlockedReason: reason });
  } catch (err) {
    logWarn("outreach.send.flag", `couldn't flag lead: ${String(err)}`, { pipeline: pipelineId, leadId: lead.id });
  }
}

// --- Bulk sending --------------------------------------------------------

/** Most leads one confirmation can cover; the rest wait for the next batch. */
const BULK_BATCH_LIMIT = 50;
/**
 * Most leads one server call processes. The client loops, one call per
 * email, and checks its Stop button between calls — so after Stop at most
 * the one email already in progress still goes out.
 */
const BULK_CHUNK_SIZE = 1;
/** Failed sends in a row (across calls) after which the bulk send gives up. */
const MAX_CONSECUTIVE_FAILURES = 3;
const BULK_CHUNK_TIME_BUDGET_MS = 30_000;
const DEFAULT_SEND_DELAY_MS = 1_000;

export type BulkPreview = {
  paused: boolean;
  /** Paused by the OUTBOUND_EMAIL_DISABLED environment variable rather than the Settings switch. */
  pausedByEnvironment: boolean;
  totalEligible: number;
  leadIds: string[];
  willSend: number;
  distinctAddresses: number;
  sample: { name: string; email: string }[];
  /** Leads the send will skip, by the reason it will give. */
  skipped: {
    duplicateInBatch: number;
    alreadyPitched: number;
    suppressed: number;
    /** The recipient's mail server refused the address on an earlier send. */
    refusedEarlier: number;
    /** A reply from the address is waiting for the operator. */
    replyNeedsLook: number;
    /** The address already answered with a plain no or a courtesy note. */
    alreadyAnswered: number;
  };
  batchLimit: number;
};

/**
 * What a bulk send would do right now: which leads it would take, how many
 * distinct addresses that is, and which would be skipped and why — every
 * refusal sendFirstTouch can know before sending (do-not-email list, an
 * earlier pitch or mail-server refusal of the address, a reply holding it,
 * the same address twice in the batch). Read-only; the send itself
 * re-checks every rule atomically per lead.
 */
export async function previewBulkSend(pipelineId: PipelineId): Promise<BulkPreview> {
  const pipeline = getPipeline(pipelineId);
  const [settings, totalEligible, batch] = await Promise.all([
    getAppSettings(),
    pipeline.countSendable(prisma),
    pipeline.listSendable(prisma, BULK_BATCH_LIMIT),
  ]);

  const emails = [...new Set(batch.map((l) => l.email!.toLowerCase()))];
  const [pitched, suppressed, holds] = await Promise.all([
    prisma.outreachRecipient.findMany({
      where: { email: { in: emails }, ...(settings.allowCrossPipelineRepeats ? { pipeline: pipelineId } : {}) },
      select: { email: true, state: true },
    }),
    prisma.suppressedEmail.findMany({ where: { email: { in: emails } }, select: { email: true } }),
    replyHolds(prisma, emails),
  ]);
  // Checked in the order sendFirstTouch checks them, so each skip is
  // counted under the reason the send will give.
  const refusedSet = new Set(pitched.filter((r) => r.state === "refused").map((r) => r.email));
  const pitchedSet = new Set(pitched.map((r) => r.email));
  const suppressedSet = new Set(suppressed.map((r) => r.email));

  const seen = new Set<string>();
  const skipped = { duplicateInBatch: 0, alreadyPitched: 0, suppressed: 0, refusedEarlier: 0, replyNeedsLook: 0, alreadyAnswered: 0 };
  const sendable: OutreachLead[] = [];
  for (const lead of batch) {
    const email = lead.email!.toLowerCase();
    const hold = holds.get(email);
    if (suppressedSet.has(email)) skipped.suppressed++;
    else if (hold?.kind === "needs_look") skipped.replyNeedsLook++;
    else if (hold?.kind === "answered") skipped.alreadyAnswered++;
    else if (refusedSet.has(email)) skipped.refusedEarlier++;
    else if (pitchedSet.has(email)) skipped.alreadyPitched++;
    else if (seen.has(email)) skipped.duplicateInBatch++;
    else {
      seen.add(email);
      sendable.push(lead);
    }
  }

  return {
    paused: settings.outboundPaused,
    pausedByEnvironment: settings.pausedBy === "environment",
    totalEligible,
    leadIds: batch.map((l) => l.id),
    willSend: sendable.length,
    distinctAddresses: seen.size,
    sample: sendable.slice(0, 5).map((l) => ({ name: l.name, email: l.email! })),
    skipped,
    batchLimit: BULK_BATCH_LIMIT,
  };
}

export type BulkChunkResult = {
  processedIds: string[];
  sent: number;
  skipped: number;
  failed: number;
  /** Addresses the recipient's mail server refused (the service itself is fine). */
  refused: number;
  messages: string[];
  stop: null | "paused" | "email_service_down";
  /** Failed sends in a row at the end of this call; pass back into the next call. */
  consecutiveFailures: number;
};

/**
 * Sends to the next few leads of a confirmed batch, stopping early on the
 * time budget (the client calls again with whatever wasn't processed), on
 * pause, or when the email service looks down.
 */
export async function sendBulkChunk(
  pipelineId: PipelineId,
  leadIds: string[],
  options: { delayMs?: number; timeBudgetMs?: number; chunkSize?: number; consecutiveFailures?: number } = {},
): Promise<BulkChunkResult> {
  const delayMs = options.delayMs ?? DEFAULT_SEND_DELAY_MS;
  const deadline = Date.now() + (options.timeBudgetMs ?? BULK_CHUNK_TIME_BUDGET_MS);
  const result: BulkChunkResult = {
    processedIds: [],
    sent: 0,
    skipped: 0,
    failed: 0,
    refused: 0,
    messages: [],
    stop: null,
    consecutiveFailures: 0,
  };
  let consecutiveFailures = Math.max(0, Math.floor(options.consecutiveFailures ?? 0));

  for (const leadId of leadIds.slice(0, options.chunkSize ?? BULK_CHUNK_SIZE)) {
    if (result.processedIds.length > 0 && Date.now() > deadline) break;
    const outcome = await sendFirstTouch(pipelineId, leadId);

    if (!outcome.ok && outcome.reason === "paused") {
      result.stop = "paused";
      result.messages.push(outcome.message);
      break;
    }
    result.processedIds.push(leadId);

    if (outcome.ok) {
      result.sent++;
      consecutiveFailures = 0;
      if (outcome.warning) result.messages.push(`${outcome.leadName}: ${outcome.warning}`);
    } else if (outcome.reason === "address_refused") {
      // The email service answered — it's this address that's bad — so
      // this neither counts toward nor breaks a run of service failures.
      result.refused++;
      result.messages.push(`${outcome.leadName ?? leadId}: ${outcome.message}`);
    } else if (outcome.reason === "send_failed" || outcome.reason === "delivery_unknown") {
      result.failed++;
      consecutiveFailures++;
      result.messages.push(`${outcome.leadName ?? leadId}: ${outcome.message}`);
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        result.stop = "email_service_down";
        break;
      }
    } else {
      result.skipped++;
      result.messages.push(outcome.message);
    }

    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  result.consecutiveFailures = consecutiveFailures;
  return result;
}
