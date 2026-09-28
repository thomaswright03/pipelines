import type { Metadata } from "next";
import { getVaultStats } from "@/lib/pipeline-stats";
import { COLD_OUTREACH_STATUSES } from "@/lib/lead-status";
import PipelineStatsPage from "@/components/PipelineStatsPage";
import { StatCard, StatSection } from "@/components/PipelineStatsWidgets";

export const metadata: Metadata = { title: "Cold Outreach — Stats" };
export const dynamic = "force-dynamic";

export default async function VaultStatsPage() {
  const s = await getVaultStats();
  return (
    <PipelineStatsPage
      title="Cold Outreach — Stats"
      noun="leads"
      s={s}
      statuses={COLD_OUTREACH_STATUSES}
      conversion={{ label: "Appointment or better", value: s.positiveOutcomes }}
      locationTitle="By state (top 10)"
      extra={
        <StatSection title="Daily automation">
          <StatCard label="Leads from daily runs" value={s.automatedLeads} sublabel={`of ${s.total.toLocaleString("en-US")} in total`} />
        </StatSection>
      }
    />
  );
}
