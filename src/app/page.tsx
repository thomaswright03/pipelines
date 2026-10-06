import type { Metadata } from "next";
import Link from "next/link";
import { PIPELINES, type InternalPipeline } from "@/lib/pipelines";
import { getPipelineMeta } from "@/lib/pipeline-meta";
import PipelineCard from "@/components/PipelineCard";
import { getDashboardNumbers } from "@/lib/dashboard";
import { parsePipelineId } from "@/lib/outreach/pipeline-id";
import { getReplyHealth } from "@/lib/outreach/reply-health";
import { ReplyIntakeWarning } from "@/components/ReplyStatus";

export const metadata: Metadata = { title: { absolute: "Cold email outreach · Dashboard" } };
export const dynamic = "force-dynamic";

export default async function Dashboard() {
  // Only the pipelines this app runs; separately hosted ones (AI Lead Responder) aren't listed.
  const [internal, replyHealth] = await Promise.all([
    Promise.all(
      PIPELINES.filter((p): p is InternalPipeline => p.kind === "internal").map(async (pipeline) => ({
        pipeline,
        meta: await getPipelineMeta(pipeline.id),
        numbers: await getDashboardNumbers(parsePipelineId(pipeline.id)),
      })),
    ),
    getReplyHealth(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="accent-text text-3xl font-bold tracking-tight">Cold email outreach</h1>
        <p className="mt-1.5 max-w-2xl text-sm muted">
          Finds leads, emails each address one pitch, tracks the replies, and puts everyone who didn&apos;t answer on a call list. New to
          the words used here? See the{" "}
          <Link href="/help#glossary" className="underline underline-offset-2">
            glossary
          </Link>
          .
        </p>
      </div>

      {replyHealth.warning && <ReplyIntakeWarning health={replyHealth} />}

      <div className="grid gap-4 lg:grid-cols-2">
        {internal.map(({ pipeline, meta, numbers }) => (
          <PipelineCard key={pipeline.id} pipelineId={pipeline.id} meta={meta} kind="internal" href={pipeline.href} numbers={numbers} />
        ))}
      </div>
    </div>
  );
}
