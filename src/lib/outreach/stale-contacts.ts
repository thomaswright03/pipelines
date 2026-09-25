// A lead that was emailed and hasn't replied within a week moves to phone
// outreach (the cold-call list, or the contactless list when there's no
// number) instead of sitting in "Contacted" forever. Same rule for both
// pipelines; run daily by /api/cron/stale-contacts.
import { prisma } from "@/lib/db";
import { routeToPhoneOutreach } from "@/lib/outreach/discovery";
import { ALL_PIPELINES } from "@/lib/outreach/pipelines";
import type { PipelineId } from "@/lib/outreach/pipeline-id";

export const STALE_CONTACT_DAYS = 7;

export type StaleContactResult = Record<PipelineId, { coldCall: number; contactless: number }>;

export async function routeStaleContacts(now: Date = new Date()): Promise<StaleContactResult> {
  const cutoff = new Date(now.getTime() - STALE_CONTACT_DAYS * 24 * 60 * 60 * 1000);
  const result = {} as StaleContactResult;
  for (const pipeline of ALL_PIPELINES) {
    const counts = { coldCall: 0, contactless: 0 };
    for (const lead of await pipeline.listStaleContacted(prisma, cutoff)) {
      const status = await routeToPhoneOutreach(pipeline.id, lead);
      if (status === "cold_call_list") counts.coldCall++;
      else counts.contactless++;
    }
    result[pipeline.id] = counts;
  }
  return result;
}
