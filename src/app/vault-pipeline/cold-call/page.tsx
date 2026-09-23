import { prisma } from "@/lib/db";
import ColdCallFlashcards from "@/components/ColdCallFlashcards";

export const dynamic = "force-dynamic";

export default async function ColdCallPage() {
  const leads = await prisma.lead.findMany({
    where: { status: "cold_call_list" },
    orderBy: [{ starred: "desc" }, { updatedAt: "desc" }],
  });

  return (
    <div>
      <h1 className="accent-text mb-4 text-center text-xl font-bold tracking-tight">Cold Call List</h1>
      <ColdCallFlashcards
        leads={leads.map((lead) => ({ id: lead.id, name: lead.name, phone: lead.phone, city: lead.city, state: lead.state }))}
      />
    </div>
  );
}
