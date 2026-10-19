import type { Metadata } from "next";
import PipelineInboxPage from "@/components/PipelineInboxPage";
import { getPipelineInbox, parseInboxTab } from "@/lib/outreach/inbox";

export const metadata: Metadata = { title: "Room Designer 3D — Sent & replies" };
export const dynamic = "force-dynamic";

export default async function RoomDesignerInboxPage({ searchParams }: PageProps<"/room-designer/inbox">) {
  const inbox = await getPipelineInbox("room-designer", parseInboxTab((await searchParams).tab));
  return <PipelineInboxPage pipeline="room-designer" title="Room Designer 3D" basePath="/room-designer" inbox={inbox} />;
}
