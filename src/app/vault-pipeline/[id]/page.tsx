import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import LeadActions from "@/components/LeadActions";
import ColdOutreachStagePanel from "@/components/ColdOutreachStagePanel";
import LeadActivityLog from "@/components/LeadActivityLog";
import { DetailField, EmailPreview, LedgerNotice, SendHistory } from "@/components/LeadDetailParts";
import { getPipeline } from "@/lib/outreach/pipelines";
import { loadLeadContext } from "@/lib/lead-page";
import { formatDate, formatDateTime, toZonedInputValue } from "@/lib/time";
import { formatCents } from "@/lib/format";
import { CALL_OUTCOME_LABEL } from "@/lib/lead-status";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // "Find email" guesses a website first, which can take a few tries.

export async function generateMetadata({ params }: PageProps<"/vault-pipeline/[id]">): Promise<Metadata> {
  const { id } = await params;
  const lead = await prisma.lead.findUnique({ where: { id }, select: { name: true } });
  return { title: lead ? `${lead.name} — Cold Outreach` : "Not found — Cold Outreach" };
}

export default async function LeadDetail({ params }: PageProps<"/vault-pipeline/[id]">) {
  const { id } = await params;
  const lead = await prisma.lead.findUnique({
    where: { id },
    include: {
      emailLogs: { orderBy: { sentAt: "desc" } },
      activities: { orderBy: { date: "desc" } },
    },
  });
  if (!lead) notFound();

  const { suppression, paused, ledgerNote } = await loadLeadContext("cold-outreach", lead.id, lead.email);
  // Exactly what a send would use.
  const preview = getPipeline("cold-outreach").buildEmail({ name: lead.name, company: lead.company, county: null });

  return (
    <div className="flex flex-col gap-6">
      <div className="min-w-0">
        <Link href="/vault-pipeline" className="text-sm font-medium text-indigo-700 hover:text-indigo-600 dark:text-indigo-300">
          ← All leads
        </Link>
        <h1 className="accent-text mt-1 break-words text-2xl font-bold tracking-tight">{lead.name}</h1>
        {lead.company && <p className="muted">{lead.company}</p>}
      </div>

      <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
        <div className="flex min-w-0 flex-col gap-4">
          <LedgerNotice note={ledgerNote} />
          <section className="card p-4" aria-label="Lead details">
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <DetailField label="Email" value={lead.email ?? "—"} href={lead.email ? `mailto:${lead.email}` : undefined} />
              {lead.email && lead.emailEvidence && <DetailField label="Why this address" value={lead.emailEvidence} />}
              <DetailField label="Phone" value={lead.phone ?? "—"} href={lead.phone ? `tel:${lead.phone}` : undefined} />
              <DetailField label="Address" value={lead.address ?? "—"} />
              <DetailField label="City/State" value={lead.city ? [lead.city, lead.state].filter(Boolean).join(", ") : "—"} />
              <DetailField label="Website" value={lead.website ?? "—"} href={lead.website ?? undefined} />
              <DetailField label="Source" value={lead.source ?? "—"} />
              <DetailField label="Added" value={formatDate(lead.createdAt)} />
              <DetailField label="Last emailed" value={formatDateTime(lead.lastEmailedAt)} />
              <DetailField label="Replied" value={formatDateTime(lead.repliedAt)} />
              <DetailField label="We replied back" value={formatDateTime(lead.ourReplyAt)} />
              <DetailField label="Appointment" value={formatDateTime(lead.appointmentAt)} />
              <DetailField
                label="Call outcome"
                value={lead.callOutcome ? (CALL_OUTCOME_LABEL[lead.callOutcome] ?? lead.callOutcome) : "—"}
              />
              <DetailField label="Estimated value" value={formatCents(lead.estimatedValueCents)} />
            </dl>
            {lead.notes && (
              <div className="mt-3 border-t border-zinc-200 pt-3 text-sm dark:border-zinc-800">
                <div className="text-sm muted">Notes</div>
                <p className="mt-1 whitespace-pre-wrap break-words">{lead.notes}</p>
              </div>
            )}
          </section>

          <EmailPreview subject={preview.subject} body={preview.body} />
          <SendHistory logs={lead.emailLogs} />
          <LeadActivityLog
            pipeline="cold-outreach"
            leadId={lead.id}
            activities={lead.activities.map((a) => ({ id: a.id, type: a.type, notes: a.notes, date: formatDateTime(a.date) }))}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <LeadActions
            pipeline="cold-outreach"
            paused={paused}
            suppression={suppression}
            lead={{
              id: lead.id,
              name: lead.name,
              status: lead.status,
              email: lead.email,
              sendBlockedReason: lead.sendBlockedReason,
              emailed: lead.emailLogs.length > 0,
              bounced: lead.emailLogs.length > 0 && lead.emailLogs.every((log) => log.bounced),
              replied: lead.repliedAt !== null,
              ourReplied: lead.ourReplyAt !== null,
              replyNeedsReview: lead.replyNeedsReview,
              replyReviewReason: lead.replyReviewReason,
            }}
          />
          <ColdOutreachStagePanel
            lead={{ id: lead.id, name: lead.name, status: lead.status, email: lead.email, replied: lead.repliedAt !== null }}
            appointmentInputValue={lead.appointmentAt ? toZonedInputValue(lead.appointmentAt) : ""}
          />
        </div>
      </div>
    </div>
  );
}
