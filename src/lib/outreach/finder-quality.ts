// How the email finder's addresses do in production, per pipeline and per
// version of the address rules (AgentLead/Lead.emailRulesVersion), over a
// recent window: bounces of found addresses against typed-in ones, replies
// saying "wrong person", and found addresses the operator replaced before
// they were pitched. The labelled sets in tests/corpus/ measure the rules
// before a change ships; these numbers show whether a change helped or hurt
// on real mail. Shown on the Unmatched replies page.
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { CHECKED_BY_HAND_PREFIX, ENTERED_BY_HAND_PREFIX } from "@/lib/outreach/evidence";
import { PIPELINE_IDS, type PipelineId } from "@/lib/outreach/pipeline-id";

/** Where an address came from: the lookup alone, the lookup then checked by a person, typed in, or not recorded (older leads). */
export type AddressSource = "found" | "checked" | "hand" | "unknown";

export type FinderQualityRow = {
  source: AddressSource;
  /** The address rules' version, for addresses the lookup found (null when found before versions were recorded). */
  rulesVersion: string | null;
  firstSent: Date | null;
  leadsEmailed: number;
  sends: number;
  bounced: number;
  /** Replies saying the address reaches the wrong person, or someone who left. */
  wrongPerson: number;
  /** Found addresses replaced by hand before the pitch (no send, so not in `sends`). */
  corrected: number;
};

export type FinderQuality = { sinceDays: number; pipelines: { pipeline: PipelineId; rows: FinderQualityRow[] }[] };

const WINDOW_DAYS = 90;
const TABLES: Record<PipelineId, { leads: string; logs: string }> = {
  dataleadsell: { leads: "AgentLead", logs: "EmailSendLog" },
  "cold-outreach": { leads: "Lead", logs: "LeadEmailSendLog" },
  "garbage-ai": { leads: "HaulerLead", logs: "HaulerEmailSendLog" },
};
const SOURCE_ORDER: AddressSource[] = ["found", "checked", "hand", "unknown"];

/** SQL for an address's source, from the lead's evidence column (aliased `d`). */
function sourceSql(): Prisma.Sql {
  return Prisma.sql`CASE WHEN d."emailEvidence" IS NULL THEN 'unknown'
                         WHEN d."emailEvidence" LIKE ${`${ENTERED_BY_HAND_PREFIX}%`} THEN 'hand'
                         WHEN d."emailEvidence" LIKE ${`${CHECKED_BY_HAND_PREFIX}%`} THEN 'checked'
                         ELSE 'found' END`;
}

async function pipelineRows(pipeline: PipelineId, since: Date): Promise<FinderQualityRow[]> {
  const leads = Prisma.raw(`"${TABLES[pipeline].leads}"`);
  const logs = Prisma.raw(`"${TABLES[pipeline].logs}"`);
  // Stored as UTC wall-clock times without a zone (see pipeline-stats.ts).
  const sinceSql = Prisma.sql`(${since.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
  const version = Prisma.sql`CASE WHEN ${sourceSql()} = 'found' THEN d."emailRulesVersion" END`;
  const [sends, replies, corrections] = await Promise.all([
    prisma.$queryRaw<
      { source: AddressSource; version: string | null; first: Date | null; sends: bigint; bounced: bigint; leads: bigint }[]
    >`
      SELECT ${sourceSql()} AS source, ${version} AS version, min(l."sentAt") AS first,
             COUNT(*)::bigint AS sends, COUNT(*) FILTER (WHERE l."bounced")::bigint AS bounced,
             COUNT(DISTINCT l."leadId")::bigint AS leads
      FROM ${logs} l JOIN ${leads} d ON d."id" = l."leadId"
      WHERE l."sentAt" >= ${sinceSql}
      GROUP BY 1, 2`,
    prisma.$queryRaw<{ source: AddressSource; version: string | null; n: bigint }[]>`
      SELECT ${sourceSql()} AS source, ${version} AS version, COUNT(DISTINCT r."id")::bigint AS n
      FROM "InboundReply" r CROSS JOIN LATERAL unnest(r."matched") AS k(key)
      JOIN ${leads} d ON k.key = ${`${pipeline}:`} || d."id"
      WHERE r."receivedAt" >= ${sinceSql} AND r."kind" = 'reply'
        AND (r."reviewReason" ILIKE '%wrong person%' OR r."reviewReason" ILIKE '%no longer work%')
      GROUP BY 1, 2`,
    prisma.outreachCorrection.groupBy({
      by: ["rulesVersion"],
      where: { kind: "address_corrected", pipeline, createdAt: { gte: since } },
      _count: { _all: true },
    }),
  ]);

  const rows = new Map<string, FinderQualityRow>();
  const row = (source: AddressSource, rulesVersion: string | null) => {
    const key = `${source}|${rulesVersion ?? ""}`;
    let found = rows.get(key);
    if (!found) {
      found = { source, rulesVersion, firstSent: null, leadsEmailed: 0, sends: 0, bounced: 0, wrongPerson: 0, corrected: 0 };
      rows.set(key, found);
    }
    return found;
  };
  for (const s of sends) {
    Object.assign(row(s.source, s.version), {
      firstSent: s.first,
      sends: Number(s.sends),
      bounced: Number(s.bounced),
      leadsEmailed: Number(s.leads),
    });
  }
  for (const r of replies) row(r.source, r.version).wrongPerson = Number(r.n);
  for (const c of corrections) row("found", c.rulesVersion).corrected = c._count._all;

  return [...rows.values()].sort(
    (a, b) =>
      SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source) || (b.firstSent?.getTime() ?? 0) - (a.firstSent?.getTime() ?? 0),
  );
}

export async function getFinderQuality(now: Date = new Date()): Promise<FinderQuality> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);
  const pipelines = await Promise.all(PIPELINE_IDS.map(async (pipeline) => ({ pipeline, rows: await pipelineRows(pipeline, since) })));
  return { sinceDays: WINDOW_DAYS, pipelines };
}
