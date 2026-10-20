import type { Metadata } from "next";
import { getRoomDesignerStats } from "@/lib/pipeline-stats";
import { ROOM_DESIGNER_STATUSES } from "@/lib/lead-status";
import PipelineStatsPage from "@/components/PipelineStatsPage";
import { StatCard, StatSection } from "@/components/PipelineStatsWidgets";

export const metadata: Metadata = { title: "Room Designer 3D — Stats" };
export const dynamic = "force-dynamic";

export default async function RoomDesignerStatsPage() {
  const s = await getRoomDesignerStats();
  return (
    <PipelineStatsPage
      title="Room Designer 3D — Stats"
      noun="remodelers"
      s={s}
      statuses={ROOM_DESIGNER_STATUSES}
      conversion={{ label: "Demo booked or better", value: s.positiveOutcomes }}
      locationTitle="By state (top 10)"
      extra={
        <StatSection title="Daily automation">
          <StatCard
            label="Remodelers from daily runs"
            value={s.automatedLeads}
            sublabel={`of ${s.total.toLocaleString("en-US")} in total`}
          />
        </StatSection>
      }
    />
  );
}
