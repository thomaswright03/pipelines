// The loop behind the bulk-send dialog: progress, Stop, and each reason it
// stops early. The server side of each chunk is tested in send.test.ts.
import { describe, expect, it } from "vitest";
import {
  bulkSendSummary,
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
        result: { processedIds: [leadIds[0]!], sent: 1, skipped: 0, failed: 0, messages: [], stop: null, consecutiveFailures: 0, ...r },
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
  const base: BulkProgress = { sent: 0, skipped: 0, failed: 0, processed: 0, total: 3, messages: [] };
  const preview = { willSend: 3, totalEligible: 3, leadIds: ["a", "b", "c"] };

  it("a clean run is a success", () => {
    expect(bulkSendSummary({ ...base, sent: 3 }, null, preview)).toEqual({ summary: "Sent 3 of 3.", tone: "success" });
  });
  it("some sent, then stopped, is a warning; nothing sent is an error", () => {
    expect(bulkSendSummary({ ...base, sent: 1 }, STOPPED_BY_USER, preview)).toMatchObject({ tone: "warning", summary: `Sent 1 of 3. ${STOPPED_BY_USER}` });
    expect(bulkSendSummary({ ...base, failed: 3 }, STOPPED_SERVICE_DOWN, preview).tone).toBe("error");
  });
  it("mentions the next batch when more leads are waiting", () => {
    expect(bulkSendSummary({ ...base, sent: 3 }, null, { ...preview, totalEligible: 5 }).summary).toBe("Sent 3 of 3. 2 more New leads can go in the next batch.");
  });
});
