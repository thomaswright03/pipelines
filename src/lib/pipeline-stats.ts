// Aggregate numbers for each pipeline's "Stats" page, computed fresh
// on every load, by one builder for both pipelines so the definitions
// can't drift apart. Day boundaries ("today", "last 7 days", the per-day bars)
// follow the operator's time zone (src/lib/time.ts), not the server's UTC.
import { prisma } from "@/lib/db";
import { dayKey, startOfZoneDay } from "@/lib/time";
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
};

export type VaultStats = BaseStats & {
  positiveOutcomes: number; // appointment_set + working_for + paying_client
  automatedLeads: number; // source = daily automated run
};

export type DataleadsellStats = BaseStats & {
  subscribed: number;
};

const TREND_DAYS = 14;

function bucketByDay(dates: Date[], days: number, now: Date = new Date()): { day: string; count: number }[] {
  const buckets = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) buckets.set(dayKey(startOfZoneDay(i, now)), 0);
  for (const date of dates) {
    const key = dayKey(new Date(date));
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return [...buckets.entries()].map(([day, count]) => ({ day, count }));
}

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function toBreakdown(groups: { key: string | null; count: number }[], limit?: number): Breakdown {
  const items = groups.map((g) => ({ label: g.key ?? "(unknown)", count: g.count })).sort((a, b) => b.count - a.count);
  return limit ? items.slice(0, limit) : items;
}

// The two lead tables (and their send logs) share every column counted
// here; Prisma's delegate types can't be unified across models, so the
// builder talks to them through these minimal views (as pipelines.ts does).
type Where = Record<string, unknown>;
type LeadTable = {
  count(args?: { where?: Where }): Promise<number>;
  groupBy(args: { by: [string]; _count: true }): Promise<({ _count: number } & Record<string, string | null>)[]>;
  findMany(args: { where: Where; select: { createdAt: true } }): Promise<{ createdAt: Date }[]>;
};
type SendLogTable = {
  count(args?: { where?: Where }): Promise<number>;
  groupBy(args: { by: ["leadId"]; where?: Where }): Promise<{ leadId: string | null }[]>;
  findMany(args: { where: Where; select: { sentAt: true } }): Promise<{ sentAt: Date }[]>;
};

const STATS_SOURCES: Record<
  PipelineId,
  { leads: () => LeadTable; sendLogs: () => SendLogTable; location: "state" | "county"; locationLimit?: number }
> = {
  "cold-outreach": {
    leads: () => prisma.lead as unknown as LeadTable,
    sendLogs: () => prisma.leadEmailSendLog as unknown as SendLogTable,
    location: "state",
    locationLimit: 10,
  },
  dataleadsell: {
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

/** Leads of this pipeline that got an automatic reply, by lead id. */
async function autoRepliedLeadIds(pipelineId: PipelineId): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<{ key: string }[]>`
    SELECT DISTINCT unnest("matched") AS key FROM "InboundReply" WHERE "kind" = 'auto_reply'`;
  const prefix = `${pipelineId}:`;
  return new Set(rows.filter((r) => r.key.startsWith(prefix)).map((r) => r.key.slice(prefix.length)));
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
    emailedGroups,
    recentSends,
    replied,
    optedOut,
    weReplied,
    autoReplied,
    sourceGroups,
    locationGroups,
    leadCreatedDates,
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
    log.groupBy({ by: ["leadId"], where: { leadId: { not: null } } }),
    log.findMany({ where: { sentAt: { gte: startOfZoneDay(TREND_DAYS - 1, now) } }, select: { sentAt: true } }),
    leads.count({ where: GENUINE_REPLY }),
    leads.count({ where: { ...EMAILED, ...OPTED_OUT } }),
    leads.count({ where: { ...GENUINE_REPLY, ourReplyAt: { not: null } } }),
    autoRepliedLeadIds(pipelineId),
    leads.groupBy({ by: ["source"], _count: true }),
    leads.groupBy({ by: [source.location], _count: true }),
    leads.findMany({ where: { createdAt: { gte: startOfZoneDay(TREND_DAYS - 1, now) } }, select: { createdAt: true } }),
  ]);

  const emailedIds = emailedGroups.map((g) => g.leadId!);
  const statusCounts = Object.fromEntries(statusGroups.map((g) => [g.status!, g._count]));
  return {
    total,
    withEmail,
    checkedNoEmail,
    neverChecked,
    starred,
    statusCounts,
    emailsSentTotal: sentTotal,
    leadsEmailed: emailedIds.length,
    emailsSentToday: sentToday,
    emailsSentLast7Days: sent7,
    emailsSentLast30Days: sent30,
    bounced,
    bounceRate: rate(bounced, sentTotal),
    replied,
    replyRate: rate(replied, emailedIds.length),
    optedOut,
    autoReplied: emailedIds.filter((id) => autoReplied.has(id)).length,
    weReplied,
    pastNew: total - (statusCounts.new ?? 0),
    bySource: toBreakdown(sourceGroups.map((g) => ({ key: g.source ?? null, count: g._count }))),
    byLocation: toBreakdown(
      locationGroups.map((g) => ({ key: g[source.location] ?? null, count: g._count })),
      source.locationLimit,
    ),
    leadsPerDay: bucketByDay(
      leadCreatedDates.map((l) => l.createdAt),
      TREND_DAYS,
      now,
    ),
    emailsPerDay: bucketByDay(
      recentSends.map((r) => r.sentAt),
      TREND_DAYS,
      now,
    ),
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
