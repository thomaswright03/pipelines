import type { Metadata } from "next";
import { getGarbageAiStats } from "@/lib/pipeline-stats";
import { GARBAGE_AI_STATUSES } from "@/lib/lead-status";
import PipelineStatsPage from "@/components/PipelineStatsPage";
import { StatCard, StatSection } from "@/components/PipelineStatsWidgets";

export const metadata: Metadata = { title: "Garbage AI — Stats" };
export const dynamic = "force-dynamic";

export default async function GarbageAiStatsPage() {
  const s = await getGarbageAiStats();
  return (
    <PipelineStatsPage
      title="Garbage AI — Stats"
      noun="haulers"
      s={s}
      statuses={GARBAGE_AI_STATUSES}
      conversion={{ label: "Demo booked or better", value: s.positiveOutcomes }}
      locationTitle="By state (top 10)"
      extra={
        <StatSection title="Daily automation">
          <StatCard label="Haulers from daily runs" value={s.automatedLeads} sublabel={`of ${s.total.toLocaleString("en-US")} in total`} />
        </StatSection>
      }
    />
  );
}
