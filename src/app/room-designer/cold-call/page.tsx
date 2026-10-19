import type { Metadata } from "next";
import CallDeckPage from "@/components/CallDeckPage";

export const metadata: Metadata = { title: "Room Designer 3D — Call deck" };
export const dynamic = "force-dynamic";

export default async function RoomDesignerCallDeck({ searchParams }: PageProps<"/room-designer/cold-call">) {
  const { after } = await searchParams;
  return <CallDeckPage pipeline="room-designer" title="Room Designer 3D — call deck" after={after} />;
}
