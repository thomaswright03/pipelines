// The client-side loop behind "Send outreach to new leads": calls the
// server one chunk at a time so progress is visible and Stop takes effect
// after the email in progress. Kept apart from the dialog component so the
// stopping rules are unit-tested (tests/bulk-send-run.test.ts).
import { plural } from "@/lib/format";
import type { BulkChunkResult, BulkPreview } from "@/lib/outreach/send";

export type BulkProgress = {
  sent: number;
  skipped: number;
  failed: number;
  /** Addresses the recipients' mail servers refused; those leads are flagged. */
  refused: number;
  processed: number;
  total: number;
  messages: string[];
};

export type SendChunk = (
  leadIds: string[],
  consecutiveFailures: number,
) => Promise<{ ok: true; result: BulkChunkResult } | { ok: false; error: string }>;

export const STOPPED_BY_USER = "You stopped the send.";
export const LOST_SERVER = "Lost contact with the server. Leads already emailed are marked Contacted; run the send again to continue.";
export const STOPPED_PAUSED = "Stopped: outbound email was paused.";
export const STOPPED_SERVICE_DOWN = "Stopped: the email service failed three times in a row. Nothing more was sent — try again later.";

/**
 * Sends to `leadIds` chunk by chunk until done, stopped, paused, the email
 * service is down, the server can't be reached, or a chunk makes no
 * progress. `onProgress` gets a fresh copy after every chunk.
 */
export async function runBulkSend(
  leadIds: string[],
  sendChunk: SendChunk,
  options: { shouldStop: () => boolean; onProgress?: (progress: BulkProgress) => void },
): Promise<{ progress: BulkProgress; stopReason: string | null }> {
  let remaining = leadIds;
  const progress: BulkProgress = { sent: 0, skipped: 0, failed: 0, refused: 0, processed: 0, total: leadIds.length, messages: [] };
  let stopReason: string | null = null;
  let consecutiveFailures = 0;

  while (remaining.length > 0) {
    if (options.shouldStop()) {
      stopReason = STOPPED_BY_USER;
      break;
    }
    let chunk;
    try {
      chunk = await sendChunk(remaining, consecutiveFailures);
    } catch {
      stopReason = LOST_SERVER;
      break;
    }
    if (!chunk.ok) {
      stopReason = chunk.error;
      break;
    }
    const r = chunk.result;
    consecutiveFailures = r.consecutiveFailures;
    progress.sent += r.sent;
    progress.skipped += r.skipped;
    progress.failed += r.failed;
    progress.refused += r.refused;
    progress.processed += r.processedIds.length;
    progress.messages.push(...r.messages);
    const done = new Set(r.processedIds);
    remaining = remaining.filter((id) => !done.has(id));
    options.onProgress?.({ ...progress, messages: [...progress.messages] });

    if (r.stop === "paused") {
      stopReason = STOPPED_PAUSED;
      break;
    }
    if (r.stop === "email_service_down") {
      stopReason = STOPPED_SERVICE_DOWN;
      break;
    }
    if (r.processedIds.length === 0) break;
  }
  return { progress, stopReason };
}

/** The closing line of a bulk send, and how it should look. */
export function bulkSendSummary(
  progress: BulkProgress,
  stopReason: string | null,
  preview: Pick<BulkPreview, "willSend" | "totalEligible" | "leadIds">,
  noun: { one: string; many: string } = { one: "lead", many: "leads" },
): { summary: string; tone: "success" | "warning" | "error" } {
  const summary =
    `Sent ${progress.sent} of ${preview.willSend}.` +
    (progress.skipped ? ` ${plural(progress.skipped, noun.one, noun.many)} skipped.` : "") +
    (progress.refused
      ? ` ${plural(progress.refused, "address", "addresses")} refused by the recipient's mail server (flagged on ${progress.refused === 1 ? `its ${noun.one}` : `their ${noun.many}`}).`
      : "") +
    (progress.failed ? ` ${plural(progress.failed, "send")} failed.` : "") +
    (stopReason ? ` ${stopReason}` : "") +
    (!stopReason && preview.totalEligible > preview.leadIds.length
      ? ` ${plural(preview.totalEligible - preview.leadIds.length, `more New ${noun.one}`, `more New ${noun.many}`)} can go in the next batch.`
      : "");
  const tone = progress.failed || stopReason ? (progress.sent ? "warning" : "error") : progress.refused ? "warning" : "success";
  return { summary, tone };
}
