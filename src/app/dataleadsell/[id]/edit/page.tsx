import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { AgentLeadForm } from "@/components/LeadForms";
import { wasPitched } from "@/lib/outreach/lead-edit";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/dataleadsell/[id]/edit">): Promise<Metadata> {
  const { id } = await params;
  const lead = await prisma.agentLead.findUnique({ where: { id }, select: { name: true } });
  return { title: lead ? `Edit ${lead.name} — dataleadsell` : "Agent not found — dataleadsell" };
}

export default async function EditAgent({ params }: PageProps<"/dataleadsell/[id]/edit">) {
  const { id } = await params;
  const lead = await prisma.agentLead.findUnique({ where: { id } });
  if (!lead) notFound();
  const locked = lead.email && (await wasPitched("dataleadsell", lead.id, lead.lastEmailedAt)) ? lead.email : null;

  return (
    <div className="mx-auto w-full max-w-lg">
      <Link href={`/dataleadsell/${lead.id}`} className="text-sm font-medium text-indigo-700 hover:text-indigo-600 dark:text-indigo-300">
        ← Back to {lead.name}
      </Link>
      <h1 className="accent-text-solid mt-1 break-words text-2xl font-bold tracking-tight">Edit {lead.name}</h1>
      <AgentLeadForm
        mode={{ kind: "edit", leadId: lead.id, emailLocked: locked }}
        initial={{
          name: lead.name,
          brokerage: lead.brokerage ?? "",
          email: lead.email ?? "",
          phone: lead.phone ?? "",
          city: lead.city ?? "",
          county: lead.county ?? "",
          website: lead.website ?? "",
          notes: lead.notes ?? "",
        }}
      />
    </div>
  );
}
