// Aggregate stats for each pipeline's "Data Central" page. Kept as plain
// read-only queries (no server actions needed — nothing here mutates
// data), computed fresh on every page load since these pages are
// force-dynamic already.
import { prisma } from "@/lib/db";

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function bucketByDay(dates: Date[], days: number): { day: string; count: number }[] {
  const buckets = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) buckets.set(dayKey(daysAgo(i)), 0);
  for (const date of dates) {
    const key = dayKey(new Date(date));
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return [...buckets.entries()].map(([day, count]) => ({ day, count }));
}

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

export type Breakdown = { label: string; count: number }[];

export type BaseStats = {
  total: number;
  withEmail: number;
  checkedNoEmail: number; // emailCheckedAt set, no email found — routed to phone-only lists
  neverChecked: number; // still in the backlog, never had an email lookup attempted
  starred: number;
  statusCounts: Record<string, number>;
  emailsSentTotal: number;
  emailsSentToday: number;
  emailsSentLast7Days: number;
  emailsSentLast30Days: number;
  bounced: number;
  bounceRate: number | null;
  replied: number;
  replyRate: number | null; // replied / emails sent
  weReplied: number;
  bySource: Breakdown;
  byLocation: Breakdown;
  leadsPerDay: { day: string; count: number }[];
  emailsPerDay: { day: string; count: number }[];
};

export type VaultStats = BaseStats & {
  positiveOutcomes: number; // appointment_set + working_for + paying_client
  conversionRate: number | null; // positiveOutcomes / total contacted or further
  automatedLeads: number; // source = daily automated run
};

export async function getVaultStats(): Promise<VaultStats> {
  const [
    total,
    withEmail,
    checkedNoEmail,
    neverChecked,
    starred,
    statusGroups,
    emailsSentTotal,
    emailsSentToday,
    emailsSentLast7Days,
    emailsSentLast30Days,
    bounced,
    replied,
    weReplied,
    sourceGroups,
    stateGroups,
    leadCreatedDates,
    emailSentDates,
    automatedLeads,
  ] = await Promise.all([
    prisma.lead.count(),
    prisma.lead.count({ where: { email: { not: null } } }),
    prisma.lead.count({ where: { email: null, emailCheckedAt: { not: null } } }),
    prisma.lead.count({ where: { email: null, emailCheckedAt: null } }),
    prisma.lead.count({ where: { starred: true } }),
    prisma.lead.groupBy({ by: ["status"], _count: true }),
    prisma.leadEmailSendLog.count(),
    prisma.leadEmailSendLog.count({ where: { sentAt: { gte: daysAgo(0) } } }),
    prisma.leadEmailSendLog.count({ where: { sentAt: { gte: daysAgo(6) } } }),
    prisma.leadEmailSendLog.count({ where: { sentAt: { gte: daysAgo(29) } } }),
    prisma.leadEmailSendLog.count({ where: { bounced: true } }),
    prisma.lead.count({ where: { repliedAt: { not: null } } }),
    prisma.lead.count({ where: { ourReplyAt: { not: null } } }),
    prisma.lead.groupBy({ by: ["source"], _count: true }),
    prisma.lead.groupBy({ by: ["state"], _count: true }),
    prisma.lead.findMany({ where: { createdAt: { gte: daysAgo(13) } }, select: { createdAt: true } }),
    prisma.leadEmailSendLog.findMany({ where: { sentAt: { gte: daysAgo(13) } }, select: { sentAt: true } }),
    prisma.lead.count({ where: { source: "Yelp search (daily automated run)" } }),
  ]);

  const statusCounts = Object.fromEntries(statusGroups.map((g) => [g.status, g._count]));
  const positiveOutcomes =
    (statusCounts.appointment_set ?? 0) + (statusCounts.working_for ?? 0) + (statusCounts.paying_client ?? 0);
  const totalContacted = total - (statusCounts.new ?? 0);

  return {
    total,
    withEmail,
    checkedNoEmail,
    neverChecked,
    starred,
    statusCounts,
    emailsSentTotal,
    emailsSentToday,
    emailsSentLast7Days,
    emailsSentLast30Days,
    bounced,
    bounceRate: rate(bounced, emailsSentTotal),
    replied,
    replyRate: rate(replied, emailsSentTotal),
    weReplied,
    bySource: sourceGroups
      .map((g) => ({ label: g.source ?? "(unknown)", count: g._count }))
      .sort((a, b) => b.count - a.count),
    byLocation: stateGroups
      .map((g) => ({ label: g.state ?? "(unknown)", count: g._count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    leadsPerDay: bucketByDay(
      leadCreatedDates.map((l) => l.createdAt),
      14,
    ),
    emailsPerDay: bucketByDay(
      emailSentDates.map((l) => l.sentAt),
      14,
    ),
    positiveOutcomes,
    conversionRate: rate(positiveOutcomes, totalContacted),
    automatedLeads,
  };
}

export type DataleadsellStats = BaseStats & {
  subscribed: number;
  conversionRate: number | null;
};

export async function getDataleadsellStats(): Promise<DataleadsellStats> {
  const [
    total,
    withEmail,
    checkedNoEmail,
    neverChecked,
    starred,
    statusGroups,
    emailsSentTotal,
    emailsSentToday,
    emailsSentLast7Days,
    emailsSentLast30Days,
    bounced,
    replied,
    weReplied,
    sourceGroups,
    countyGroups,
    leadCreatedDates,
    emailSentDates,
  ] = await Promise.all([
    prisma.agentLead.count(),
    prisma.agentLead.count({ where: { email: { not: null } } }),
    prisma.agentLead.count({ where: { email: null, emailCheckedAt: { not: null } } }),
    prisma.agentLead.count({ where: { email: null, emailCheckedAt: null } }),
    prisma.agentLead.count({ where: { starred: true } }),
    prisma.agentLead.groupBy({ by: ["status"], _count: true }),
    prisma.emailSendLog.count(),
    prisma.emailSendLog.count({ where: { sentAt: { gte: daysAgo(0) } } }),
    prisma.emailSendLog.count({ where: { sentAt: { gte: daysAgo(6) } } }),
    prisma.emailSendLog.count({ where: { sentAt: { gte: daysAgo(29) } } }),
    prisma.emailSendLog.count({ where: { bounced: true } }),
    prisma.agentLead.count({ where: { repliedAt: { not: null } } }),
    prisma.agentLead.count({ where: { ourReplyAt: { not: null } } }),
    prisma.agentLead.groupBy({ by: ["source"], _count: true }),
    prisma.agentLead.groupBy({ by: ["county"], _count: true }),
    prisma.agentLead.findMany({ where: { createdAt: { gte: daysAgo(13) } }, select: { createdAt: true } }),
    prisma.emailSendLog.findMany({ where: { sentAt: { gte: daysAgo(13) } }, select: { sentAt: true } }),
  ]);

  const statusCounts = Object.fromEntries(statusGroups.map((g) => [g.status, g._count]));
  const subscribed = statusCounts.subscribed ?? 0;
  const totalContacted = total - (statusCounts.new ?? 0);

  return {
    total,
    withEmail,
    checkedNoEmail,
    neverChecked,
    starred,
    statusCounts,
    emailsSentTotal,
    emailsSentToday,
    emailsSentLast7Days,
    emailsSentLast30Days,
    bounced,
    bounceRate: rate(bounced, emailsSentTotal),
    replied,
    replyRate: rate(replied, emailsSentTotal),
    weReplied,
    bySource: sourceGroups
      .map((g) => ({ label: g.source ?? "(unknown)", count: g._count }))
      .sort((a, b) => b.count - a.count),
    byLocation: countyGroups
      .map((g) => ({ label: g.county ?? "(unknown)", count: g._count }))
      .sort((a, b) => b.count - a.count),
    leadsPerDay: bucketByDay(
      leadCreatedDates.map((l) => l.createdAt),
      14,
    ),
    emailsPerDay: bucketByDay(
      emailSentDates.map((l) => l.sentAt),
      14,
    ),
    subscribed,
    conversionRate: rate(subscribed, totalContacted),
  };
}
