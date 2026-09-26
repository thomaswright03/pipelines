import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { ColdOutreachLeadForm } from "@/components/LeadForms";
import { wasPitched } from "@/lib/outreach/lead-edit";
import { centsToInput } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/vault-pipeline/[id]/edit">): Promise<Metadata> {
  const { id } = await params;
  const lead = await prisma.lead.findUnique({ where: { id }, select: { name: true } });
  return { title: lead ? `Edit ${lead.name} — Cold Outreach` : "Lead not found — Cold Outreach" };
}

export default async function EditLead({ params }: PageProps<"/vault-pipeline/[id]/edit">) {
  const { id } = await params;
  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) notFound();
  const locked = lead.email && (await wasPitched("cold-outreach", lead.id, lead.lastEmailedAt)) ? lead.email : null;

  return (
    <div className="mx-auto w-full max-w-lg">
      <Link href={`/vault-pipeline/${lead.id}`} className="text-sm font-medium text-indigo-700 hover:text-indigo-600 dark:text-indigo-300">
        ← Back to {lead.name}
      </Link>
      <h1 className="accent-text-solid mt-1 break-words text-2xl font-bold tracking-tight">Edit {lead.name}</h1>
      <ColdOutreachLeadForm
        mode={{ kind: "edit", leadId: lead.id, emailLocked: locked }}
        initial={{
          name: lead.name,
          company: lead.company ?? "",
          email: lead.email ?? "",
          phone: lead.phone ?? "",
          address: lead.address ?? "",
          city: lead.city ?? "",
          state: lead.state ?? "",
          website: lead.website ?? "",
          source: lead.source ?? "",
          estimatedValue: centsToInput(lead.estimatedValueCents),
          notes: lead.notes ?? "",
        }}
      />
    </div>
  );
}
