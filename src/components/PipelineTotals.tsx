import { StatCard } from "@/components/PipelineStatsWidgets";
import { LEAD_NOUN, type PipelineId } from "@/lib/outreach/pipeline-id";

/**
 * The summary at the top of every pipeline page's tools: how many leads
 * the pipeline has and how many of them have an email address. The same
 * two tiles, in the same place, on all three pipelines.
 */
export default function PipelineTotals({ pipeline, total, withEmail }: { pipeline: PipelineId; total: number; withEmail: number }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <StatCard label={`Total ${LEAD_NOUN[pipeline].many}`} value={total} />
      <StatCard label="With email" value={withEmail} />
    </div>
  );
}
