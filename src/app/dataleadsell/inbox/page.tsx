import type { Metadata } from "next";
import PipelineInboxPage from "@/components/PipelineInboxPage";
import { getPipelineInbox, parseInboxTab } from "@/lib/outreach/inbox";

export const metadata: Metadata = { title: "dataleadsell.com — Inbox" };
export const dynamic = "force-dynamic";

export default async function DataleadsellInboxPage({ searchParams }: PageProps<"/dataleadsell/inbox">) {
  const inbox = await getPipelineInbox("dataleadsell", parseInboxTab((await searchParams).tab));
  return <PipelineInboxPage pipeline="dataleadsell" title="dataleadsell.com" basePath="/dataleadsell" inbox={inbox} />;
}
