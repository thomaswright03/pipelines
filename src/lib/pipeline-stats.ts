// Aggregate numbers for each pipeline's "Stats" page, computed fresh
// on every load, by one builder for both pipelines so the definitions
// can't drift apart. Day boundaries ("today", "last 7 days", the per-day bars)
// follow the operator's time zone (src/lib/time.ts), not the server's UTC.
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { numberVersions } from "@/lib/template-versions";
import { APP_TIME_ZONE, dayKey, startOfZoneDay } from "@/lib/time";
import { DAILY_RUN_SOURCE } from "@/lib/vault-daily-run";
import { OPTED_OUT_BLOCK_PREFIX } from "@/lib/outreach/send";
import type { PipelineId } from "@/lib/outreach/pipeline-id";

export type Breakdown = { label: string; count: number }[];

export type BaseStats = {
  total: number;
  withEmail: number;
  checkedNoEmail: number; // emailCheckedAt set, no email found — routed to phone-only lists
  neverChecked: number; // still in the backlog, never had an email lookup attempted
  starred: number;
  statusCounts: Record<string, number>;
  emailsSentTotal: number;
  leadsEmailed: number; // distinct leads with at least one send
  emailsSentToday: number;
  emailsSentLast7Days: number;
  emailsSentLast30Days: number;
  bounced: number;
  bounceRate: number | null; // bounced sends ÷ sends
  /** Emailed leads a person replied to (opt-outs and automatic replies excluded). */
  replied: number;
  replyRate: number | null; // replied ÷ distinct leads emailed
  /** Emailed leads that asked not to be emailed (by reply or marked by hand). */
  optedOut: number;
  /** Emailed leads that got an automatic reply (out-of-office…), whether or not a person replied later. */
  autoReplied: number;
  /** Of `replied`, how many we answered. */
  weReplied: number;
  pastNew: number; // leads no longer in "new" — the conversion rate's denominator
  bySource: Breakdown;
  byLocation: Breakdown;
  leadsPerDay: { day: string; count: number }[];
  emailsPerDay: { day: string; count: number }[];
  /** Sends and replies per version of the pitch's wording, newest version first. */
  byTemplate: TemplateStats[];
};

export type TemplateStats = {
  /** Null for sends made before versions were recorded. */
  version: string | null;
  /** "Email version N" — numbered in the order versions were first sent; null with `version`. */
  number: number | null;
  firstSent: Date | null;
  subject: string | null;
  sent: number;
  /** Distinct leads emailed with this version. */
  leads: number;
  /** Of `leads`, how many a person replied to (opt-outs excluded). */
  replied: number;
  replyRate: number | null;
};

export type VaultStats = BaseStats & {
  positiveOutcomes: number; // appointment_set + working_for + paying_client
  automatedLeads: number; // source = daily automated run
};

export type DataleadsellStats = BaseStats & {
  subscribed: number;
};

const TREND_DAYS = 14;

/** One bar per zone day for the last `days` days, filled from per-day counts computed in SQL. */
function fillDays(counts: { day: string; count: number }[], days: number, now: Date): { day: string; count: number }[] {
  const buckets = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) buckets.set(dayKey(startOfZoneDay(i, now)), 0);
  for (const { day, count } of counts) if (buckets.has(day)) buckets.set(day, count);
  return [...buckets.entries()].map(([day, count]) => ({ day, count }));
}

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

/** Counts per value, largest first; leads with no value are counted under `missingLabel`. */
function toBreakdown(groups: { key: string | null; count: number }[], missingLabel: string, limit?: number): Breakdown {
  const counts = new Map<string, number>();
  for (const g of groups) {
    const label = g.key?.trim() ? g.key : missingLabel; // null and "" are both "not recorded"
    counts.set(label, (counts.get(label) ?? 0) + g.count);
  }
  const items = [...counts].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
  return limit ? items.slice(0, limit) : items;
}

// The two lead tables (and their send logs) share every column counted
// here; Prisma's delegate types can't be unified across models, so the
// builder talks to them through these minimal views (as pipelines.ts does).
type Where = Record<string, unknown>;
type LeadTable = {
  count(args?: { where?: Where }): Promise<number>;
  groupBy(args: { by: [string]; _count: true }): Promise<({ _count: number } & Record<string, string | null>)[]>;
};
type SendLogTable = {
  count(args?: { where?: Where }): Promise<number>;
};

const STATS_SOURCES: Record<
  PipelineId,
  {
    leads: () => LeadTable;
    sendLogs: () => SendLogTable;
    /** Table names for the aggregates done in SQL (fixed strings, never user input). */
    leadTable: string;
    logTable: string;
    location: "state" | "county";
    locationLimit?: number;
  }
> = {
  "cold-outreach": {
    leadTable: "Lead",
    logTable: "LeadEmailSendLog",
    leads: () => prisma.lead as unknown as LeadTable,
    sendLogs: () => prisma.leadEmailSendLog as unknown as SendLogTable,
    location: "state",
    locationLimit: 10,
  },
  dataleadsell: {
    leadTable: "AgentLead",
    logTable: "EmailSendLog",
    leads: () => prisma.agentLead as unknown as LeadTable,
    sendLogs: () => prisma.emailSendLog as unknown as SendLogTable,
    location: "county",
  },
};

const EMAILED = { emailLogs: { some: {} } };
const OPTED_OUT = { sendBlockedReason: { startsWith: OPTED_OUT_BLOCK_PREFIX } };
const NOT_OPTED_OUT = { OR: [{ sendBlockedReason: null }, { NOT: OPTED_OUT }] };
/** A person replied: a reply time (automatic replies never set one), and not an opt-out. */
const GENUINE_REPLY = { ...EMAILED, repliedAt: { not: null }, ...NOT_OPTED_OUT };

/** Emailed leads of this pipeline that got an automatic reply. */
async function countAutoRepliedEmailed(pipelineId: PipelineId, logTable: string): Promise<number> {
  const prefix = `${pipelineId}:`;
  const [row] = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(DISTINCT k.key)::bigint AS n
    FROM (SELECT unnest("matched") AS key FROM "InboundReply" WHERE "kind" = 'auto_reply') k
    WHERE left(k.key, ${prefix.length}) = ${prefix}
      AND EXISTS (SELECT 1 FROM ${Prisma.raw(`"${logTable}"`)} l WHERE l."leadId" = substr(k.key, ${prefix.length + 1}))`;
  return Number(row?.n ?? 0);
}

/** Sends, leads and genuine replies per template version (see email-template-version.ts). */
async function countByTemplate(logTable: string, leadTable: string): Promise<TemplateStats[]> {
  const rows = await prisma.$queryRaw<
    { version: string | null; subject: string | null; firstSent: Date | null; sent: bigint; leads: bigint; replied: bigint }[]
  >`
    SELECT l."templateVersion" AS version,
           min(l."sentAt") AS "firstSent",
           max(l."subject") AS subject,
           COUNT(*)::bigint AS sent,
           COUNT(DISTINCT l."leadId")::bigint AS leads,
           COUNT(DISTINCT l."leadId") FILTER (
             WHERE d."repliedAt" IS NOT NULL
               AND (d."sendBlockedReason" IS NULL OR left(d."sendBlockedReason", ${OPTED_OUT_BLOCK_PREFIX.length}) <> ${OPTED_OUT_BLOCK_PREFIX})
           )::bigint AS replied
    FROM ${Prisma.raw(`"${logTable}"`)} l
    LEFT JOIN ${Prisma.raw(`"${leadTable}"`)} d ON d."id" = l."leadId"
    GROUP BY 1
    ORDER BY min(l."sentAt") DESC`;
  const numbers = numberVersions(rows);
  return rows.map((r) => ({
    version: r.version,
    number: r.version ? (numbers.get(r.version)?.number ?? null) : null,
    firstSent: r.firstSent,
    subject: r.subject,
    sent: Number(r.sent),
    leads: Number(r.leads),
    replied: Number(r.replied),
    replyRate: rate(Number(r.replied), Number(r.leads)),
  }));
}

async function countDistinctEmailedLeads(logTable: string): Promise<number> {
  const [row] = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(DISTINCT "leadId")::bigint AS n FROM ${Prisma.raw(`"${logTable}"`)}`;
  return Number(row?.n ?? 0);
}

/**
 * Rows per calendar day (in the app's time zone) since `since`, counted in
 * SQL. Timestamps are stored as UTC wall-clock times without a zone.
 */
async function countPerZoneDay(table: string, column: "createdAt" | "sentAt", since: Date): Promise<{ day: string; count: number }[]> {
  const col = Prisma.raw(`"${column}"`);
  const rows = await prisma.$queryRaw<{ day: string; n: bigint }[]>`
    SELECT to_char((${col} AT TIME ZONE 'UTC') AT TIME ZONE ${APP_TIME_ZONE}, 'YYYY-MM-DD') AS day, COUNT(*)::bigint AS n
    FROM ${Prisma.raw(`"${table}"`)}
    WHERE ${col} >= (${since.toISOString()}::timestamptz AT TIME ZONE 'UTC')
    GROUP BY 1`;
  return rows.map((r) => ({ day: r.day, count: Number(r.n) }));
}

/** Every number on a pipeline's Stats page, with the same definitions for both pipelines. */
async function getPipelineStats(pipelineId: PipelineId, now: Date = new Date()): Promise<BaseStats> {
  const source = STATS_SOURCES[pipelineId];
  const leads = source.leads();
  const log = source.sendLogs();
  const [
    total,
    withEmail,
    checkedNoEmail,
    neverChecked,
    starred,
    statusGroups,
    sentTotal,
    sentToday,
    sent7,
    sent30,
    bounced,
    leadsEmailed,
    sendsPerDay,
    replied,
    optedOut,
    weReplied,
    autoReplied,
    sourceGroups,
    locationGroups,
    leadsCreatedPerDay,
    byTemplate,
  ] = await Promise.all([
    leads.count(),
    leads.count({ where: { email: { not: null } } }),
    leads.count({ where: { email: null, emailCheckedAt: { not: null } } }),
    leads.count({ where: { email: null, emailCheckedAt: null } }),
    leads.count({ where: { starred: true } }),
    leads.groupBy({ by: ["status"], _count: true }),
    log.count(),
    log.count({ where: { sentAt: { gte: startOfZoneDay(0, now) } } }),
    log.count({ where: { sentAt: { gte: startOfZoneDay(6, now) } } }),
    log.count({ where: { sentAt: { gte: startOfZoneDay(29, now) } } }),
    log.count({ where: { bounced: true } }),
    countDistinctEmailedLeads(source.logTable),
    countPerZoneDay(source.logTable, "sentAt", startOfZoneDay(TREND_DAYS - 1, now)),
    leads.count({ where: GENUINE_REPLY }),
    leads.count({ where: { ...EMAILED, ...OPTED_OUT } }),
    leads.count({ where: { ...GENUINE_REPLY, ourReplyAt: { not: null } } }),
    countAutoRepliedEmailed(pipelineId, source.logTable),
    leads.groupBy({ by: ["source"], _count: true }),
    leads.groupBy({ by: [source.location], _count: true }),
    countPerZoneDay(source.leadTable, "createdAt", startOfZoneDay(TREND_DAYS - 1, now)),
    countByTemplate(source.logTable, source.leadTable),
  ]);

  const statusCounts = Object.fromEntries(statusGroups.map((g) => [g.status!, g._count]));
  return {
    total,
    withEmail,
    checkedNoEmail,
    neverChecked,
    starred,
    statusCounts,
    emailsSentTotal: sentTotal,
    leadsEmailed,
    emailsSentToday: sentToday,
    emailsSentLast7Days: sent7,
    emailsSentLast30Days: sent30,
    bounced,
    bounceRate: rate(bounced, sentTotal),
    replied,
    replyRate: rate(replied, leadsEmailed),
    optedOut,
    autoReplied,
    weReplied,
    pastNew: total - (statusCounts.new ?? 0),
    bySource: toBreakdown(
      sourceGroups.map((g) => ({ key: g.source ?? null, count: g._count })),
      "No source recorded",
    ),
    byLocation: toBreakdown(
      locationGroups.map((g) => ({ key: g[source.location] ?? null, count: g._count })),
      `No ${source.location} recorded`,
      source.locationLimit,
    ),
    leadsPerDay: fillDays(leadsCreatedPerDay, TREND_DAYS, now),
    emailsPerDay: fillDays(sendsPerDay, TREND_DAYS, now),
    byTemplate,
  };
}

export async function getVaultStats(now: Date = new Date()): Promise<VaultStats> {
  const [base, automatedLeads] = await Promise.all([
    getPipelineStats("cold-outreach", now),
    prisma.lead.count({ where: { source: DAILY_RUN_SOURCE } }),
  ]);
  const c = base.statusCounts;
  return { ...base, positiveOutcomes: (c.appointment_set ?? 0) + (c.working_for ?? 0) + (c.paying_client ?? 0), automatedLeads };
}

export async function getDataleadsellStats(now: Date = new Date()): Promise<DataleadsellStats> {
  const base = await getPipelineStats("dataleadsell", now);
  return { ...base, subscribed: base.statusCounts.subscribed ?? 0 };
}
