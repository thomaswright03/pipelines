// The one place outreach email gets sent from — single sends, bulk sends
// and the daily cron all come through sendFirstTouch(). The rules:
//
// - Only a lead in "new" with an address and no block flag gets the
//   first-touch pitch.
// - Nothing is sent while outbound email is paused (Settings).
// - Nothing is sent to a suppressed (opted-out) address.
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
import { getAppSettings, PAUSED_MESSAGE, recordSendFailure } from "@/lib/outreach/settings";
import { getPipeline, type Db, type OutreachLead } from "@/lib/outreach/pipelines";
import { PIPELINE_LABEL, type PipelineId } from "@/lib/outreach/pipeline-id";
import { statusLabel } from "@/lib/lead-status";

// An arbitrary constant namespacing this app's advisory locks.
const ADDRESS_LOCK_NAMESPACE = 4242;

export const DUPLICATE_BLOCK_PREFIX = "Duplicate address";
export const OPTED_OUT_BLOCK_PREFIX = "Opted out";
/** Set by the migration on addresses the old, unchecked website guess found. */
export const UNVERIFIED_BLOCK_PREFIX = "Unverified address";
/** Blocks that are about the lead's current address, so they end when the address changes. */
export const ADDRESS_BLOCK_PREFIXES = [DUPLICATE_BLOCK_PREFIX, OPTED_OUT_BLOCK_PREFIX, UNVERIFIED_BLOCK_PREFIX];

export type SendRefusal = "paused" | "not_found" | "no_email" | "not_new" | "blocked" | "suppressed" | "duplicate_address";

export type SendOutcome =
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
): Promise<{ pipeline: PipelineId; leadId: string | null; leadName: string | null } | null> {
  const row = await db.outreachRecipient.findFirst({
    where: { email, ...(allowCrossPipelineRepeats ? { pipeline } : {}) },
    orderBy: { claimedAt: "asc" },
  });
  if (!row) return null;
  const other = row.pipeline as PipelineId;
  const lead = row.leadId ? await getPipeline(other).findLead(db, row.leadId) : null;
  return { pipeline: other, leadId: row.leadId, leadName: lead?.name ?? null };
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

  const claimedAt = new Date();
  let recipientId: string;
  try {
    recipientId = await prisma.$transaction(async (tx) => {
      await lockAddress(tx, email);
      const settings = await getAppSettings(tx);
      if (settings.outboundPaused) throw new Refusal("paused", PAUSED_MESSAGE);

      if (await tx.suppressedEmail.findUnique({ where: { email } })) {
        throw new Refusal("suppressed", `${email} opted out of our emails — nothing was sent.`);
      }

      const existing = await findExistingPitch(tx, pipelineId, email, settings.allowCrossPipelineRepeats);
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

  const { subject, body } = pipeline.buildEmail(lead);
  let providerMessageId: string;
  try {
    ({ providerMessageId } = await sendOutreachEmail(pipeline.senderEmail, email, subject, body));
  } catch (err) {
    const failure = classifySendError(err);
    logError("outreach.send", err, { pipeline: pipelineId, leadId, delivery: failure.delivery });
    await recordSendFailure(failure.message);
    if (failure.delivery === "not_sent") {
      await prisma.$transaction(async (tx) => {
        await tx.outreachRecipient.delete({ where: { id: recipientId } });
        await pipeline.releaseClaim(tx, leadId, claimedAt, { lastEmailedAt: lead.lastEmailedAt, repliedAt: lead.repliedAt });
      });
      return fail("send_failed", failure.message);
    }
    await prisma.outreachRecipient.update({
      where: { id: recipientId },
      data: { state: "unknown", lastError: failure.message },
    });
    return fail("delivery_unknown", failure.message);
  }

  const sentAt = new Date();
  try {
    await prisma.$transaction(async (tx) => {
      await tx.outreachRecipient.update({
        where: { id: recipientId },
        data: { state: "sent", sentAt, providerMessageId },
      });
      await pipeline.recordSend(tx, leadId, email, providerMessageId, sentAt);
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

async function flagIfPermanent(pipelineId: PipelineId, lead: OutreachLead, refusal: Refusal): Promise<void> {
  const email = lead.email?.toLowerCase();
  let reason: string | null = null;
  if (refusal.reason === "duplicate_address") {
    reason = `${DUPLICATE_BLOCK_PREFIX} — ${email} was already pitched, so this lead is never auto-sent.`;
  } else if (refusal.reason === "suppressed") {
    reason = `${OPTED_OUT_BLOCK_PREFIX} — ${email} is on the suppression list.`;
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
  totalEligible: number;
  leadIds: string[];
  willSend: number;
  distinctAddresses: number;
  sample: { name: string; email: string }[];
  skipped: { duplicateInBatch: number; alreadyPitched: number; suppressed: number };
  batchLimit: number;
};

/**
 * What a bulk send would do right now: which leads it would take, how many
 * distinct addresses that is, and which would be skipped and why. Read-only;
 * the send itself re-checks every rule atomically per lead.
 */
export async function previewBulkSend(pipelineId: PipelineId): Promise<BulkPreview> {
  const pipeline = getPipeline(pipelineId);
  const [settings, totalEligible, batch] = await Promise.all([
    getAppSettings(),
    pipeline.countSendable(prisma),
    pipeline.listSendable(prisma, BULK_BATCH_LIMIT),
  ]);

  const emails = [...new Set(batch.map((l) => l.email!.toLowerCase()))];
  const [pitched, suppressed] = await Promise.all([
    prisma.outreachRecipient.findMany({
      where: { email: { in: emails }, ...(settings.allowCrossPipelineRepeats ? { pipeline: pipelineId } : {}) },
      select: { email: true },
    }),
    prisma.suppressedEmail.findMany({ where: { email: { in: emails } }, select: { email: true } }),
  ]);
  const pitchedSet = new Set(pitched.map((r) => r.email));
  const suppressedSet = new Set(suppressed.map((r) => r.email));

  const seen = new Set<string>();
  const skipped = { duplicateInBatch: 0, alreadyPitched: 0, suppressed: 0 };
  const sendable: OutreachLead[] = [];
  for (const lead of batch) {
    const email = lead.email!.toLowerCase();
    if (suppressedSet.has(email)) skipped.suppressed++;
    else if (pitchedSet.has(email)) skipped.alreadyPitched++;
    else if (seen.has(email)) skipped.duplicateInBatch++;
    else {
      seen.add(email);
      sendable.push(lead);
    }
  }

  return {
    paused: settings.outboundPaused,
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
