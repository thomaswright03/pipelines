import { PIPELINES } from "@/lib/pipelines";
import { getPipelineMeta } from "@/lib/pipeline-meta";
import PipelineCard from "@/components/PipelineCard";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const cards = await Promise.all(
    PIPELINES.map(async (pipeline) => ({ pipeline, meta: await getPipelineMeta(pipeline.id) })),
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="accent-text text-3xl font-bold tracking-tight">Marketing Pipelines</h1>
        <p className="mt-1.5 text-sm muted">Every outreach pipeline in one place.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map(({ pipeline, meta }) =>
          pipeline.kind === "internal" ? (
            <PipelineCard key={pipeline.id} pipelineId={pipeline.id} meta={meta} kind="internal" href={pipeline.href} />
          ) : (
            <PipelineCard key={pipeline.id} pipelineId={pipeline.id} meta={meta} kind="hosted" dashboardUrl={pipeline.dashboardUrl} />
          ),
        )}
      </div>
    </div>
  );
}
