import type { Metadata } from "next";
import CallDeckPage from "@/components/CallDeckPage";

export const metadata: Metadata = { title: "Garbage AI — Call deck" };
export const dynamic = "force-dynamic";

export default async function GarbageAiCallDeck({ searchParams }: PageProps<"/garbage-ai/cold-call">) {
  const { after } = await searchParams;
  return <CallDeckPage pipeline="garbage-ai" title="Garbage AI — call deck" after={after} />;
}
