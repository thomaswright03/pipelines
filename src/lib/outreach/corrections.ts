// Operator corrections to the automatic heuristics, recorded where they
// happen, and summed up as the production quality signal on the Replies
// page. The labelled corpus in tests/corpus/ measures the heuristics
// before a change ships; these counts show how they do on real mail.
import { prisma } from "@/lib/db";
import type { Db } from "@/lib/outreach/pipelines";
import type { PipelineId } from "@/lib/outreach/pipeline-id";

export type CorrectionKind =
  /** An opt-out read from a reply was removed from the do-not-email list (a false positive). */
  | "opt_out_reversed"
  /** "Mark opted out" on a lead whose reply was recorded but not read as an opt-out (a missed one). */
  | "opt_out_missed"
  /** "Mark bounced" on an address the email lookup found (it wasn't typed in). */
  | "wrong_address";

export async function recordCorrection(
  db: Db,
  entry: { kind: CorrectionKind; pipeline?: PipelineId; leadId?: string; email?: string | null; detail?: string | null },
): Promise<void> {
  await db.outreachCorrection.create({
    data: {
      kind: entry.kind,
      pipeline: entry.pipeline ?? null,
      leadId: entry.leadId ?? null,
      email: entry.email ?? null,
      detail: entry.detail?.slice(0, 500) ?? null,
    },
  });
}

export type QualitySignals = {
  sinceDays: number;
  /** Replies read as opt-outs, and how many of those the operator reversed. */
  autoOptOuts: number;
  optOutsReversed: number;
  /** Replies not read as opt-outs that the operator then marked opted out. */
  optOutsMissed: number;
  /** Replies flagged "needs a look" (possible no / complaint), and how many said "wrong person". */
  flaggedForReview: number;
  wrongPerson: number;
  /** Found addresses (not typed in) that bounced. */
  foundAddressesBounced: number;
};

const QUALITY_WINDOW_DAYS = 90;

export async function getQualitySignals(now: Date = new Date()): Promise<QualitySignals> {
  const since = new Date(now.getTime() - QUALITY_WINDOW_DAYS * 86_400_000);
  const recent = { gte: since };
  const [autoOptOuts, flaggedForReview, wrongPerson, corrections] = await Promise.all([
    prisma.inboundReply.count({ where: { optedOut: true, receivedAt: recent } }),
    prisma.inboundReply.count({ where: { reviewReason: { not: null }, receivedAt: recent } }),
    prisma.inboundReply.count({ where: { reviewReason: { contains: "wrong person" }, receivedAt: recent } }),
    prisma.outreachCorrection.groupBy({ by: ["kind"], where: { createdAt: recent }, _count: { _all: true } }),
  ]);
  const count = (kind: CorrectionKind) => corrections.find((c) => c.kind === kind)?._count._all ?? 0;
  return {
    sinceDays: QUALITY_WINDOW_DAYS,
    autoOptOuts,
    optOutsReversed: count("opt_out_reversed"),
    optOutsMissed: count("opt_out_missed"),
    flaggedForReview,
    wrongPerson,
    foundAddressesBounced: count("wrong_address"),
  };
}
