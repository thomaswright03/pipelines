import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import LeadActions from "@/components/LeadActions";
import { DetailField, EmailPreview, LedgerNotice, SendHistory } from "@/components/LeadDetailParts";
import { buildAgentOutreachEmail } from "@/lib/dataleadsell-email-template";
import { loadLeadContext } from "@/lib/lead-page";
import { formatDate, formatDateTime } from "@/lib/time";
import { CALL_OUTCOME_LABEL } from "@/lib/lead-status";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // "Find email" guesses a website first, which can take a few tries.

export default async function AgentLeadDetail({ params }: PageProps<"/dataleadsell/[id]">) {
  const { id } = await params;
  const lead = await prisma.agentLead.findUnique({ where: { id }, include: { emailLogs: { orderBy: { sentAt: "desc" } } } });
  if (!lead) notFound();

  const { suppression, paused, ledgerNote } = await loadLeadContext("dataleadsell", lead.id, lead.email);
  const preview = buildAgentOutreachEmail(lead.name, lead.county);

  return (
    <div className="flex flex-col gap-6">
      <div className="min-w-0">
        <Link href="/dataleadsell" className="text-sm font-medium text-indigo-700 hover:text-indigo-600 dark:text-indigo-300">
          ← All agents
        </Link>
        <h1 className="accent-text mt-1 break-words text-2xl font-bold tracking-tight">{lead.name}</h1>
        {lead.brokerage && <p className="muted">{lead.brokerage}</p>}
      </div>

      <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
        <div className="flex min-w-0 flex-col gap-4">
          <LedgerNotice note={ledgerNote} />
          <section className="card p-4" aria-label="Agent details">
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <DetailField label="Email" value={lead.email ?? "—"} href={lead.email ? `mailto:${lead.email}` : undefined} />
              <DetailField label="Phone" value={lead.phone ?? "—"} href={lead.phone ? `tel:${lead.phone}` : undefined} />
              <DetailField label="City" value={lead.city ?? "—"} />
              <DetailField label="County" value={lead.county ? `${lead.county}, ${lead.state ?? ""}` : "—"} />
              <DetailField label="Website" value={lead.website ?? "—"} href={lead.website ?? undefined} />
              <DetailField label="Source" value={lead.source ?? "—"} />
              <DetailField label="Added" value={formatDate(lead.createdAt)} />
              <DetailField label="Last emailed" value={formatDateTime(lead.lastEmailedAt)} />
              <DetailField label="Replied" value={formatDateTime(lead.repliedAt)} />
              <DetailField label="We replied back" value={formatDateTime(lead.ourReplyAt)} />
              <DetailField label="Call outcome" value={lead.callOutcome ? (CALL_OUTCOME_LABEL[lead.callOutcome] ?? lead.callOutcome) : "—"} />
            </dl>
            {lead.notes && (
              <div className="mt-3 border-t border-zinc-200 pt-3 text-sm dark:border-zinc-800">
                <div className="text-xs muted">Notes</div>
                <p className="mt-1 whitespace-pre-wrap break-words">{lead.notes}</p>
              </div>
            )}
          </section>

          <EmailPreview subject={preview.subject} body={preview.body} />
          <SendHistory logs={lead.emailLogs} />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <LeadActions
            pipeline="dataleadsell"
            paused={paused}
            suppression={suppression}
            lead={{
              id: lead.id,
              name: lead.name,
              status: lead.status,
              email: lead.email,
              sendBlockedReason: lead.sendBlockedReason,
              emailed: lead.emailLogs.length > 0,
              replied: lead.repliedAt !== null,
              ourReplied: lead.ourReplyAt !== null,
              replyNeedsReview: lead.replyNeedsReview,
            }}
          />
        </div>
      </div>
    </div>
  );
}
