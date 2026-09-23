import Link from "next/link";
import { getDataleadsellStats } from "@/lib/pipeline-stats";
import { StatCard, StatSection, BreakdownList, DayTrend, formatPercent } from "@/components/PipelineStatsWidgets";

export const dynamic = "force-dynamic";

export default async function DataleadsellStatsPage() {
  const s = await getDataleadsellStats();

  const STATUS_LABEL: Record<string, string> = {
    new: "New",
    contacted: "Contacted",
    responded: "Responded",
    subscribed: "Subscribed",
    not_interested: "Not interested",
    cold_call_list: "Cold Call List",
    contactless_list: "Contactless List",
    lost: "Lost",
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="accent-text text-2xl font-bold tracking-tight">dataleadsell.com — Data Central</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Every number this pipeline tracks, in one place.
          </p>
        </div>
        <Link href="/dataleadsell" className="btn-secondary shrink-0">
          ← Back to agents
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total agents" value={s.total} />
        <StatCard label="With email" value={s.withEmail} sublabel={`${s.checkedNoEmail} checked, no email`} />
        <StatCard label="Never checked" value={s.neverChecked} sublabel="not yet swept for an email" />
        <StatCard label="Starred" value={s.starred} />
      </div>

      <StatSection title="Email performance">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Sent (all time)" value={s.emailsSentTotal} />
          <StatCard label="Sent today" value={s.emailsSentToday} />
          <StatCard label="Sent, last 7 days" value={s.emailsSentLast7Days} />
          <StatCard label="Sent, last 30 days" value={s.emailsSentLast30Days} />
          <StatCard label="Replied" value={s.replied} sublabel={`${formatPercent(s.replyRate)} reply rate`} />
          <StatCard label="Bounced" value={s.bounced} sublabel={`${formatPercent(s.bounceRate)} bounce rate`} />
          <StatCard label="We replied back" value={s.weReplied} />
          <StatCard
            label="Subscribed"
            value={s.subscribed}
            sublabel={`${formatPercent(s.conversionRate)} of contacted`}
          />
        </div>
      </StatSection>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatSection title="Agents added — last 14 days">
          <DayTrend points={s.leadsPerDay} />
        </StatSection>
        <StatSection title="Emails sent — last 14 days">
          <DayTrend points={s.emailsPerDay} />
        </StatSection>
      </div>

      <StatSection title="By status">
        <BreakdownList
          items={Object.entries(s.statusCounts).map(([status, count]) => ({
            label: STATUS_LABEL[status] ?? status,
            count,
          }))}
          emptyLabel="No agents yet."
        />
      </StatSection>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatSection title="By source">
          <BreakdownList items={s.bySource} emptyLabel="No agents yet." />
        </StatSection>
        <StatSection title="By county">
          <BreakdownList items={s.byLocation} emptyLabel="No agents yet." />
        </StatSection>
      </div>
    </div>
  );
}
