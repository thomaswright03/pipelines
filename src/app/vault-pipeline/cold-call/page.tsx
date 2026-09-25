import type { Metadata } from "next";
import ColdCallFlashcards from "@/components/ColdCallFlashcards";
import { loadCallDeck } from "@/lib/call-deck";

export const metadata: Metadata = { title: "Cold Outreach — Call deck" };
export const dynamic = "force-dynamic";

export default async function ColdCallPage() {
  const leads = await loadCallDeck("cold-outreach");
  return (
    <div>
      <h1 className="accent-text mb-4 text-center text-xl font-bold tracking-tight">Cold Outreach — call deck</h1>
      <ColdCallFlashcards pipeline="cold-outreach" leads={leads} />
    </div>
  );
}
