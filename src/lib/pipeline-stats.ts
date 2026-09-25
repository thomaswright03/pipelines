// Aggregate numbers for each pipeline's "Data Central" page, computed fresh
// on every load. Day boundaries ("today", "last 7 days", the per-day bars)
// follow the operator's time zone (src/lib/time.ts), not the server's UTC.
import { prisma } from "@/lib/db";
import { dayKey, startOfZoneDay } from "@/lib/time";
import { DAILY_RUN_SOURCE } from "@/lib/vault-daily-run";

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
  replied: number; // emailed leads that replied
  replyRate: number | null; // replied ÷ distinct leads emailed
  weReplied: number;
  bySource: Breakdown;
  byLocation: Breakdown;
  leadsPerDay: { day: string; count: number }[];
  emailsPerDay: { day: string; count: number }[];
};

export type VaultStats = BaseStats & {
  positiveOutcomes: number; // appointment_set + working_for + paying_client
  conversionRate: number | null; // positiveOutcomes ÷ leads past "new"
  automatedLeads: number; // source = daily automated run
};

export type DataleadsellStats = BaseStats & {
  subscribed: number;
  conversionRate: number | null; // subscribed ÷ leads past "new"
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

type SendLogDelegate = {
  count(args?: { where?: object }): Promise<number>;
  groupBy(args: { by: ["leadId"]; where?: object }): Promise<{ leadId: string | null }[]>;
  findMany(args: { where: object; select: { sentAt: true } }): Promise<{ sentAt: Date }[]>;
};

async function sendStats(log: SendLogDelegate, now: Date) {
  const [total, today, last7, last30, bounced, emailedGroups, recent] = await Promise.all([
    log.count(),
    log.count({ where: { sentAt: { gte: startOfZoneDay(0, now) } } }),
    log.count({ where: { sentAt: { gte: startOfZoneDay(6, now) } } }),
    log.count({ where: { sentAt: { gte: startOfZoneDay(29, now) } } }),
    log.count({ where: { bounced: true } }),
    log.groupBy({ by: ["leadId"], where: { leadId: { not: null } } }),
    log.findMany({ where: { sentAt: { gte: startOfZoneDay(TREND_DAYS - 1, now) } }, select: { sentAt: true } }),
  ]);
  return { total, today, last7, last30, bounced, leadsEmailed: emailedGroups.length, recent: recent.map((r) => r.sentAt) };
}

export async function getVaultStats(now: Date = new Date()): Promise<VaultStats> {
  const [
    total,
    withEmail,
    checkedNoEmail,
    neverChecked,
    starred,
    statusGroups,
    sends,
    replied,
    weReplied,
    sourceGroups,
    stateGroups,
    leadCreatedDates,
    automatedLeads,
  ] = await Promise.all([
    prisma.lead.count(),
    prisma.lead.count({ where: { email: { not: null } } }),
    prisma.lead.count({ where: { email: null, emailCheckedAt: { not: null } } }),
    prisma.lead.count({ where: { email: null, emailCheckedAt: null } }),
    prisma.lead.count({ where: { starred: true } }),
    prisma.lead.groupBy({ by: ["status"], _count: true }),
    sendStats(prisma.leadEmailSendLog as unknown as SendLogDelegate, now),
    prisma.lead.count({ where: { repliedAt: { not: null }, emailLogs: { some: {} } } }),
    prisma.lead.count({ where: { ourReplyAt: { not: null } } }),
    prisma.lead.groupBy({ by: ["source"], _count: true }),
    prisma.lead.groupBy({ by: ["state"], _count: true }),
    prisma.lead.findMany({ where: { createdAt: { gte: startOfZoneDay(TREND_DAYS - 1, now) } }, select: { createdAt: true } }),
    prisma.lead.count({ where: { source: DAILY_RUN_SOURCE } }),
  ]);

  const statusCounts = Object.fromEntries(statusGroups.map((g) => [g.status, g._count]));
  const positiveOutcomes =
    (statusCounts.appointment_set ?? 0) + (statusCounts.working_for ?? 0) + (statusCounts.paying_client ?? 0);
  const pastNew = total - (statusCounts.new ?? 0);

  return {
    total,
    withEmail,
    checkedNoEmail,
    neverChecked,
    starred,
    statusCounts,
    emailsSentTotal: sends.total,
    leadsEmailed: sends.leadsEmailed,
    emailsSentToday: sends.today,
    emailsSentLast7Days: sends.last7,
    emailsSentLast30Days: sends.last30,
    bounced: sends.bounced,
    bounceRate: rate(sends.bounced, sends.total),
    replied,
    replyRate: rate(replied, sends.leadsEmailed),
    weReplied,
    bySource: toBreakdown(sourceGroups.map((g) => ({ key: g.source, count: g._count }))),
    byLocation: toBreakdown(
      stateGroups.map((g) => ({ key: g.state, count: g._count })),
      10,
    ),
    leadsPerDay: bucketByDay(
      leadCreatedDates.map((l) => l.createdAt),
      TREND_DAYS,
      now,
    ),
    emailsPerDay: bucketByDay(sends.recent, TREND_DAYS, now),
    positiveOutcomes,
    conversionRate: rate(positiveOutcomes, pastNew),
    automatedLeads,
  };
}

export async function getDataleadsellStats(now: Date = new Date()): Promise<DataleadsellStats> {
  const [
    total,
    withEmail,
    checkedNoEmail,
    neverChecked,
    starred,
    statusGroups,
    sends,
    replied,
    weReplied,
    sourceGroups,
    countyGroups,
    leadCreatedDates,
  ] = await Promise.all([
    prisma.agentLead.count(),
    prisma.agentLead.count({ where: { email: { not: null } } }),
    prisma.agentLead.count({ where: { email: null, emailCheckedAt: { not: null } } }),
    prisma.agentLead.count({ where: { email: null, emailCheckedAt: null } }),
    prisma.agentLead.count({ where: { starred: true } }),
    prisma.agentLead.groupBy({ by: ["status"], _count: true }),
    sendStats(prisma.emailSendLog as unknown as SendLogDelegate, now),
    prisma.agentLead.count({ where: { repliedAt: { not: null }, emailLogs: { some: {} } } }),
    prisma.agentLead.count({ where: { ourReplyAt: { not: null } } }),
    prisma.agentLead.groupBy({ by: ["source"], _count: true }),
    prisma.agentLead.groupBy({ by: ["county"], _count: true }),
    prisma.agentLead.findMany({
      where: { createdAt: { gte: startOfZoneDay(TREND_DAYS - 1, now) } },
      select: { createdAt: true },
    }),
  ]);

  const statusCounts = Object.fromEntries(statusGroups.map((g) => [g.status, g._count]));
  const subscribed = statusCounts.subscribed ?? 0;
  const pastNew = total - (statusCounts.new ?? 0);

  return {
    total,
    withEmail,
    checkedNoEmail,
    neverChecked,
    starred,
    statusCounts,
    emailsSentTotal: sends.total,
    leadsEmailed: sends.leadsEmailed,
    emailsSentToday: sends.today,
    emailsSentLast7Days: sends.last7,
    emailsSentLast30Days: sends.last30,
    bounced: sends.bounced,
    bounceRate: rate(sends.bounced, sends.total),
    replied,
    replyRate: rate(replied, sends.leadsEmailed),
    weReplied,
    bySource: toBreakdown(sourceGroups.map((g) => ({ key: g.source, count: g._count }))),
    byLocation: toBreakdown(countyGroups.map((g) => ({ key: g.county, count: g._count }))),
    leadsPerDay: bucketByDay(
      leadCreatedDates.map((l) => l.createdAt),
      TREND_DAYS,
      now,
    ),
    emailsPerDay: bucketByDay(sends.recent, TREND_DAYS, now),
    subscribed,
    conversionRate: rate(subscribed, pastNew),
  };
}
