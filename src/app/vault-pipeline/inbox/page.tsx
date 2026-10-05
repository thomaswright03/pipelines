import type { Metadata } from "next";
import PipelineInboxPage from "@/components/PipelineInboxPage";
import { getPipelineInbox, parseInboxTab } from "@/lib/outreach/inbox";

export const metadata: Metadata = { title: "Cold Outreach — Sent & replies" };
export const dynamic = "force-dynamic";

export default async function ColdOutreachInboxPage({ searchParams }: PageProps<"/vault-pipeline/inbox">) {
  const inbox = await getPipelineInbox("cold-outreach", parseInboxTab((await searchParams).tab));
  return <PipelineInboxPage pipeline="cold-outreach" title="Cold Outreach" basePath="/vault-pipeline" inbox={inbox} />;
}
