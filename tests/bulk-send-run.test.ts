// The loop behind the bulk-send dialog: progress, Stop, and each reason it
// stops early. The server side of each chunk is tested in send.test.ts.
import { describe, expect, it } from "vitest";
import {
  batchesFor,
  bulkSendSummary,
  nextBatchAfter,
  LOST_SERVER,
  runBulkSend,
  STOPPED_BY_USER,
  STOPPED_PAUSED,
  STOPPED_SERVICE_DOWN,
  type BulkProgress,
  type SendChunk,
} from "@/lib/bulk-send-run";
import type { BulkChunkResult } from "@/lib/outreach/send";

const ids = ["a", "b", "c", "d"];

/** A fake server that processes one lead per call with the given results, in order. */
function server(results: Partial<BulkChunkResult>[]): { chunk: SendChunk; calls: { ids: string[]; failures: number }[] } {
  const calls: { ids: string[]; failures: number }[] = [];
  let n = 0;
  return {
    calls,
    chunk: async (leadIds, failures) => {
      calls.push({ ids: leadIds, failures });
      const r = results[n++] ?? {};
      return {
        ok: true,
        result: {
          processedIds: [leadIds[0]!],
          sent: 1,
          skipped: 0,
          failed: 0,
          refused: 0,
          messages: [],
          stop: null,
          consecutiveFailures: 0,
          ...r,
        },
      };
    },
  };
}

describe("runBulkSend", () => {
  it("sends every lead, reporting progress after each chunk", async () => {
    const { chunk, calls } = server([]);
    const seen: BulkProgress[] = [];
    const { progress, stopReason } = await runBulkSend(ids, chunk, { shouldStop: () => false, onProgress: (p) => seen.push(p) });
    expect(stopReason).toBeNull();
    expect(progress).toMatchObject({ sent: 4, processed: 4, total: 4 });
    expect(seen.map((p) => p.processed)).toEqual([1, 2, 3, 4]);
    expect(calls.map((c) => c.ids.length)).toEqual([4, 3, 2, 1]);
  });

  it("Stop takes effect after the email in progress", async () => {
    const { chunk, calls } = server([]);
    let stop = false;
    const { progress, stopReason } = await runBulkSend(ids, chunk, {
      shouldStop: () => stop,
      onProgress: (p) => {
        if (p.processed === 2) stop = true;
      },
    });
    expect(stopReason).toBe(STOPPED_BY_USER);
    expect(progress.sent).toBe(2);
    expect(calls).toHaveLength(2);
  });

  it("stops when the email service fails three times in a row, passing the failure count along", async () => {
    const failed = (n: number): Partial<BulkChunkResult> => ({ sent: 0, failed: 1, consecutiveFailures: n });
    const { chunk, calls } = server([failed(1), failed(2), { ...failed(3), stop: "email_service_down" }]);
    const { progress, stopReason } = await runBulkSend(ids, chunk, { shouldStop: () => false });
    expect(stopReason).toBe(STOPPED_SERVICE_DOWN);
    expect(progress).toMatchObject({ sent: 0, failed: 3 });
    expect(calls.map((c) => c.failures)).toEqual([0, 1, 2]);
  });

  it("stops when sending is paused mid-run", async () => {
    const { chunk } = server([{}, { sent: 0, processedIds: [], stop: "paused" }]);
    const { progress, stopReason } = await runBulkSend(ids, chunk, { shouldStop: () => false });
    expect(stopReason).toBe(STOPPED_PAUSED);
    expect(progress.sent).toBe(1);
  });

  it("stops, saying so, when the server can't be reached or refuses", async () => {
    const lost = await runBulkSend(ids, async () => Promise.reject(new Error("network")), { shouldStop: () => false });
    expect(lost.stopReason).toBe(LOST_SERVER);
    const refused = await runBulkSend(ids, async () => ({ ok: false, error: "Unknown pipeline." }), { shouldStop: () => false });
    expect(refused.stopReason).toBe("Unknown pipeline.");
  });

  it("stops rather than looping when a chunk processes nothing", async () => {
    const { chunk, calls } = server([{ processedIds: [], sent: 0 }]);
    const { stopReason } = await runBulkSend(ids, chunk, { shouldStop: () => false });
    expect(stopReason).toBeNull();
    expect(calls).toHaveLength(1);
  });
});

describe("bulkSendSummary", () => {
  const base: BulkProgress = { sent: 0, skipped: 0, failed: 0, refused: 0, processed: 0, total: 3, messages: [] };
  const preview = { willSend: 3, totalEligible: 3, leadIds: ["a", "b", "c"], batchLimit: 3 };

  it("a clean run is a success", () => {
    expect(bulkSendSummary({ ...base, sent: 3 }, null, preview)).toEqual({ summary: "Sent 3 of 3.", tone: "success" });
  });
  it("some sent, then stopped, is a warning; nothing sent is an error", () => {
    expect(bulkSendSummary({ ...base, sent: 1 }, STOPPED_BY_USER, preview)).toMatchObject({
      tone: "warning",
      summary: `Sent 1 of 3. ${STOPPED_BY_USER}`,
    });
    expect(bulkSendSummary({ ...base, failed: 3 }, STOPPED_SERVICE_DOWN, preview).tone).toBe("error");
  });
  it("names refused addresses without blaming the email service", () => {
    const result = bulkSendSummary({ ...base, sent: 2, refused: 1 }, null, preview);
    expect(result).toEqual({
      summary: "Sent 2 of 3. 1 address refused by the recipient's mail server (flagged on its lead).",
      tone: "warning",
    });
    expect(result.summary).not.toMatch(/email service/);
  });
  it("says how many leads and batches are left when more are waiting", () => {
    expect(bulkSendSummary({ ...base, sent: 3 }, null, { ...preview, totalEligible: 5 }).summary).toBe(
      "Sent 3 of 3. 2 more New leads left: 1 more batch of up to 3.",
    );
    expect(bulkSendSummary({ ...base, sent: 3 }, null, { ...preview, totalEligible: 10 }, { one: "agent", many: "agents" }).summary).toBe(
      "Sent 3 of 3. 7 more New agents left: 3 more batches of up to 3.",
    );
  });
});

describe("the next batch", () => {
  const preview = (totalEligible: number, inBatch = 50) => ({
    totalEligible,
    leadIds: Array.from({ length: Math.min(inBatch, totalEligible) }, (_, i) => `l${i}`),
    batchLimit: 50,
  });

  it("counts batches of up to the limit", () => {
    expect([0, 1, 50, 51, 100, 2_858].map((n) => batchesFor(n, 50))).toEqual([0, 1, 1, 2, 2, 58]);
  });
  it("is offered after a batch that ran to the end, sized to what's left", () => {
    expect(nextBatchAfter(null, preview(2_858))).toEqual({ remaining: 2_808, batches: 57, size: 50 });
    expect(nextBatchAfter(null, preview(70))).toEqual({ remaining: 20, batches: 1, size: 20 });
  });
  it("isn't offered when nothing is left, or after a stop, a pause, a failure or a lost connection", () => {
    expect(nextBatchAfter(null, preview(50))).toBeNull();
    for (const reason of [STOPPED_BY_USER, STOPPED_PAUSED, STOPPED_SERVICE_DOWN, LOST_SERVER]) {
      expect(nextBatchAfter(reason, preview(2_858))).toBeNull();
    }
  });
});
