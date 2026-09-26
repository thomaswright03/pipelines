// Both pipelines' Stats pages: one layout, so a change is made once.
import type { ReactNode } from "react";
import type { BaseStats } from "@/lib/pipeline-stats";
import {
  BreakdownList,
  DayTrend,
  EmailPerformance,
  StatCard,
  StatSection,
  StatusBreakdown,
  TemplateBreakdown,
} from "@/components/PipelineStatsWidgets";

export default function PipelineStatsPage({
  title,
  noun,
  s,
  statuses,
  conversion,
  locationTitle,
  extra,
}: {
  title: string;
  /** What leads are called in this pipeline: "leads" / "agents". */
  noun: string;
  s: BaseStats;
  statuses: readonly string[];
  conversion: { label: string; value: number };
  locationTitle: string;
  /** Pipeline-specific sections, shown after Email performance. */
  extra?: ReactNode;
}) {
  const Noun = noun[0]!.toUpperCase() + noun.slice(1);
  const empty = `No ${noun} yet.`;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="accent-text text-2xl font-bold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm muted">Every number this pipeline tracks, worked out fresh on each visit.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label={`Total ${noun}`} value={s.total} />
        <StatCard label="With email" value={s.withEmail} sublabel="an address was found or entered" />
        <StatCard label="Checked, no address found" value={s.checkedNoEmail} sublabel="phone outreach only" />
        <StatCard label="Never checked" value={s.neverChecked} sublabel="no email lookup yet" />
        <StatCard label="Starred" value={s.starred} />
      </div>

      <EmailPerformance s={s} conversion={conversion} />

      <StatSection title="Reply rate by email version">
        <TemplateBreakdown rows={s.byTemplate} noun={noun} />
      </StatSection>

      {extra}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatSection title={`${Noun} added — last 14 days`}>
          <DayTrend points={s.leadsPerDay} noun={`${noun} added`} />
        </StatSection>
        <StatSection title="Emails sent — last 14 days">
          <DayTrend points={s.emailsPerDay} noun="emails sent" />
        </StatSection>
      </div>

      <StatSection title="By status">
        <StatusBreakdown counts={s.statusCounts} statuses={statuses} emptyLabel={empty} />
      </StatSection>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatSection title="By source">
          <BreakdownList items={s.bySource} emptyLabel={empty} />
        </StatSection>
        <StatSection title={locationTitle}>
          <BreakdownList items={s.byLocation} emptyLabel={empty} />
        </StatSection>
      </div>
    </div>
  );
}
