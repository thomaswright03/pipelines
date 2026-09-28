// A lead that was emailed and hasn't replied within a week moves to phone
// outreach (the cold-call list, or the contactless list when there's no
// number) instead of sitting in "Contacted" forever, with a History entry
// saying so. A lead with a reply flagged "needs a look" (a possible "no" or
// complaint) is not moved until the operator resolves the flag, so nobody
// who complained lands on the call deck. Same rule for both pipelines; run
// daily by /api/cron/stale-contacts.
import { prisma } from "@/lib/db";
import { ALL_PIPELINES, STALE_CONTACT_DAYS } from "@/lib/outreach/pipelines";
import type { PipelineId } from "@/lib/outreach/pipeline-id";

export { STALE_CONTACT_DAYS };

export type StaleContactResult = Record<PipelineId, { coldCall: number; contactless: number }>;

export async function routeStaleContacts(now: Date = new Date()): Promise<StaleContactResult> {
  const cutoff = new Date(now.getTime() - STALE_CONTACT_DAYS * 24 * 60 * 60 * 1000);
  const result = {} as StaleContactResult;
  for (const pipeline of ALL_PIPELINES) {
    // Set-based and conditional on the lead still being Contacted, so it
    // finishes in a couple of queries at any backlog, and a lead that
    // replied or was moved by hand a moment earlier is left alone.
    result[pipeline.id] = await pipeline.routeStaleContacted(prisma, cutoff, now);
  }
  return result;
}
