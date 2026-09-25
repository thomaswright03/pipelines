import { prisma } from "@/lib/db";
import ColdCallFlashcards from "@/components/ColdCallFlashcards";

export const dynamic = "force-dynamic";

// Agents who didn't answer the email (or had none) — the phone follow-up.
export default async function AgentColdCallPage() {
  const leads = await prisma.agentLead.findMany({
    where: { status: "cold_call_list" },
    orderBy: [{ starred: "desc" }, { updatedAt: "desc" }],
    take: 200,
  });

  return (
    <div>
      <h1 className="accent-text mb-4 text-center text-xl font-bold tracking-tight">dataleadsell.com — call deck</h1>
      <ColdCallFlashcards
        pipeline="dataleadsell"
        leads={leads.map((lead) => ({
          id: lead.id,
          name: lead.name,
          subtitle: lead.brokerage,
          phone: lead.phone,
          city: lead.city,
          state: lead.state,
        }))}
      />
    </div>
  );
}
