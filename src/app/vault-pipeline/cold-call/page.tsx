import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import ColdCallFlashcards from "@/components/ColdCallFlashcards";

export const metadata: Metadata = { title: "Cold Outreach — Call deck" };
export const dynamic = "force-dynamic";

export default async function ColdCallPage() {
  const leads = await prisma.lead.findMany({
    where: { status: "cold_call_list" },
    orderBy: [{ starred: "desc" }, { updatedAt: "desc" }],
    take: 200,
  });

  return (
    <div>
      <h1 className="accent-text mb-4 text-center text-xl font-bold tracking-tight">Cold Outreach — call deck</h1>
      <ColdCallFlashcards
        pipeline="cold-outreach"
        leads={leads.map((lead) => ({
          id: lead.id,
          name: lead.name,
          subtitle: lead.company,
          phone: lead.phone,
          city: lead.city,
          state: lead.state,
        }))}
      />
    </div>
  );
}
