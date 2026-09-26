import type { Metadata } from "next";
import { PIPELINES, type HostedPipeline, type InternalPipeline } from "@/lib/pipelines";
import { getPipelineMeta } from "@/lib/pipeline-meta";
import PipelineCard from "@/components/PipelineCard";
import { getDashboardNumbers } from "@/lib/dashboard";
import { parsePipelineId } from "@/lib/outreach/pipeline-id";

export const metadata: Metadata = { title: { absolute: "Dashboard · Pipelines" } };
export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const [internal, hosted] = await Promise.all([
    Promise.all(
      PIPELINES.filter((p): p is InternalPipeline => p.kind === "internal").map(async (pipeline) => ({
        pipeline,
        meta: await getPipelineMeta(pipeline.id),
        numbers: await getDashboardNumbers(parsePipelineId(pipeline.id)),
      })),
    ),
    Promise.all(
      PIPELINES.filter((p): p is HostedPipeline => p.kind === "hosted").map(async (pipeline) => ({
        pipeline,
        meta: await getPipelineMeta(pipeline.id),
      })),
    ),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="accent-text text-3xl font-bold tracking-tight">Marketing Pipelines</h1>
        <p className="mt-1.5 max-w-2xl text-sm muted">
          Finds leads, emails each address one pitch, tracks the replies, and puts everyone who didn&apos;t answer on a call list.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {internal.map(({ pipeline, meta, numbers }) => (
          <PipelineCard key={pipeline.id} pipelineId={pipeline.id} meta={meta} kind="internal" href={pipeline.href} numbers={numbers} />
        ))}
      </div>

      {hosted.length > 0 && (
        <section aria-labelledby="elsewhere-heading" className="flex flex-col gap-2">
          <h2 id="elsewhere-heading" className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            Runs elsewhere
          </h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {hosted.map(({ pipeline, meta }) => (
              <PipelineCard key={pipeline.id} pipelineId={pipeline.id} meta={meta} kind="hosted" dashboardUrl={pipeline.dashboardUrl} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
