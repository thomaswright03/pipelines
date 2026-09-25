import type { Metadata } from "next";
import ColdCallFlashcards from "@/components/ColdCallFlashcards";
import { loadCallDeck } from "@/lib/call-deck";

export const metadata: Metadata = { title: "dataleadsell — Call deck" };
export const dynamic = "force-dynamic";

// Agents who didn't answer the email (or had none) — the phone follow-up.
export default async function AgentColdCallPage() {
  const leads = await loadCallDeck("dataleadsell");
  return (
    <div>
      <h1 className="accent-text mb-4 text-center text-xl font-bold tracking-tight">dataleadsell.com — call deck</h1>
      <ColdCallFlashcards pipeline="dataleadsell" leads={leads} />
    </div>
  );
}
