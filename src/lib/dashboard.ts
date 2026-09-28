// The few numbers each in-app pipeline shows on the dashboard: what is
// waiting on the operator (ready to email, replies to look at, calls to
// make) and what is waiting on the leads.
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getPipeline } from "@/lib/outreach/pipelines";
import type { PipelineId } from "@/lib/outreach/pipeline-id";

export type DashboardNumbers = {
  /** New, with an address, not held back: what Send outreach would email. */
  readyToEmail: number;
  /** Emailed, no reply yet. */
  waitingOnReply: number;
  onCallDeck: number;
  /** In Responded: a person replied and the lead hasn't been moved on yet. */
  replied: number;
  /** Replies flagged "needs a look" that the operator hasn't resolved. */
  needsALook: number;
};

const LEAD_TABLE: Record<PipelineId, string> = { "cold-outreach": "Lead", dataleadsell: "AgentLead" };

export async function getDashboardNumbers(pipelineId: PipelineId): Promise<DashboardNumbers> {
  const [readyToEmail, [row]] = await Promise.all([
    getPipeline(pipelineId).countSendable(prisma),
    prisma.$queryRaw<{ waiting: bigint; deck: bigint; replied: bigint; review: bigint }[]>`
      SELECT COUNT(*) FILTER (WHERE "status" = 'contacted')::bigint AS waiting,
             COUNT(*) FILTER (WHERE "status" = 'cold_call_list')::bigint AS deck,
             COUNT(*) FILTER (WHERE "status" = 'responded')::bigint AS replied,
             COUNT(*) FILTER (WHERE "replyNeedsReview")::bigint AS review
      FROM ${Prisma.raw(`"${LEAD_TABLE[pipelineId]}"`)}`,
  ]);
  return {
    readyToEmail,
    waitingOnReply: Number(row?.waiting ?? 0),
    onCallDeck: Number(row?.deck ?? 0),
    replied: Number(row?.replied ?? 0),
    needsALook: Number(row?.review ?? 0),
  };
}
