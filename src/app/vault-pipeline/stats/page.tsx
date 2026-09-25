import { getVaultStats } from "@/lib/pipeline-stats";
import { COLD_OUTREACH_STATUSES } from "@/lib/lead-status";
import { StatCard, StatSection, BreakdownList, DayTrend, EmailPerformance, StatusBreakdown } from "@/components/PipelineStatsWidgets";

export const dynamic = "force-dynamic";

export default async function VaultStatsPage() {
  const s = await getVaultStats();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="accent-text text-2xl font-bold tracking-tight">Cold Outreach — Data Central</h1>
        <p className="mt-1 text-sm muted">Every number this pipeline tracks, worked out fresh on each visit.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total leads" value={s.total} />
        <StatCard label="With email" value={s.withEmail} sublabel={`${s.checkedNoEmail.toLocaleString("en-US")} checked, none found`} />
        <StatCard label="Never checked" value={s.neverChecked} sublabel="no email lookup yet" />
        <StatCard label="Starred" value={s.starred} />
      </div>

      <EmailPerformance
        s={s}
        conversion={{ label: "Appointment or better", value: s.positiveOutcomes }}
      />

      <StatSection title="Daily automation">
        <StatCard label="Leads from daily runs" value={s.automatedLeads} sublabel={`of ${s.total.toLocaleString("en-US")} in total`} />
      </StatSection>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatSection title="Leads added — last 14 days">
          <DayTrend points={s.leadsPerDay} noun="leads added" />
        </StatSection>
        <StatSection title="Emails sent — last 14 days">
          <DayTrend points={s.emailsPerDay} noun="emails sent" />
        </StatSection>
      </div>

      <StatSection title="By status">
        <StatusBreakdown counts={s.statusCounts} statuses={COLD_OUTREACH_STATUSES} emptyLabel="No leads yet." />
      </StatSection>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatSection title="By source">
          <BreakdownList items={s.bySource} emptyLabel="No leads yet." />
        </StatSection>
        <StatSection title="By state (top 10)">
          <BreakdownList items={s.byLocation} emptyLabel="No leads yet." />
        </StatSection>
      </div>
    </div>
  );
}
