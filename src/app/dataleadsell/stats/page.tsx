import type { Metadata } from "next";
import { getDataleadsellStats } from "@/lib/pipeline-stats";
import { DATALEADSELL_STATUSES } from "@/lib/lead-status";
import PipelineStatsPage from "@/components/PipelineStatsPage";

export const metadata: Metadata = { title: "dataleadsell — Stats" };
export const dynamic = "force-dynamic";

export default async function DataleadsellStatsPage() {
  const s = await getDataleadsellStats();
  return (
    <PipelineStatsPage
      title="dataleadsell.com — Stats"
      noun="agents"
      s={s}
      statuses={DATALEADSELL_STATUSES}
      conversion={{ label: "Subscribed", value: s.subscribed }}
      locationTitle="By county"
    />
  );
}
