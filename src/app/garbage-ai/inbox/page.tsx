import type { Metadata } from "next";
import PipelineInboxPage from "@/components/PipelineInboxPage";
import { getPipelineInbox, parseInboxTab } from "@/lib/outreach/inbox";

export const metadata: Metadata = { title: "Garbage AI — Inbox" };
export const dynamic = "force-dynamic";

export default async function GarbageAiInboxPage({ searchParams }: PageProps<"/garbage-ai/inbox">) {
  const inbox = await getPipelineInbox("garbage-ai", parseInboxTab((await searchParams).tab));
  return <PipelineInboxPage pipeline="garbage-ai" title="Garbage AI" basePath="/garbage-ai" inbox={inbox} />;
}
