import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import LeadActions from "@/components/LeadActions";
import { DetailField, LeadPageLayout } from "@/components/LeadDetailParts";
import { getPipeline } from "@/lib/outreach/pipelines";
import { loadLeadContext } from "@/lib/lead-page";
import { templateVersionHistory } from "@/lib/template-versions";
import { formatDate, formatDateTime } from "@/lib/time";
import { CALL_OUTCOME_LABEL } from "@/lib/lead-status";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // "Find email" guesses a website first, which can take a few tries.

export async function generateMetadata({ params }: PageProps<"/dataleadsell/[id]">): Promise<Metadata> {
  const { id } = await params;
  const lead = await prisma.agentLead.findUnique({ where: { id }, select: { name: true } });
  return { title: lead ? `${lead.name} — dataleadsell` : "Not found — dataleadsell" };
}

export default async function AgentLeadDetail({ params }: PageProps<"/dataleadsell/[id]">) {
  const { id } = await params;
  const lead = await prisma.agentLead.findUnique({
    where: { id },
    include: { emailLogs: { orderBy: { sentAt: "desc" } }, activities: { orderBy: { date: "desc" } } },
  });
  if (!lead) notFound();

  const [{ suppression, paused, ledgerNote, latestReply }, versionHistory] = await Promise.all([
    loadLeadContext("dataleadsell", lead.id, lead.email),
    templateVersionHistory("dataleadsell"),
  ]);
  // Exactly what a send would use.
  const preview = getPipeline("dataleadsell").buildEmail({ name: lead.name, company: null, county: lead.county });

  return (
    <LeadPageLayout
      pipeline="dataleadsell"
      back={{ href: "/dataleadsell", label: "All agents" }}
      lead={lead}
      subtitle={lead.brokerage}
      detailsLabel="Agent details"
      ledgerNote={ledgerNote}
      preview={preview}
      versionHistory={versionHistory}
      sendLogs={lead.emailLogs}
      activities={lead.activities}
      details={
        <>
          <DetailField label="Email" value={lead.email ?? "—"} href={lead.email ? `mailto:${lead.email}` : undefined} />
          {lead.email && lead.emailEvidence && <DetailField label="Why this address" value={lead.emailEvidence} />}
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
        </>
      }
      actions={
        <LeadActions
          pipeline="dataleadsell"
          paused={paused}
          suppression={suppression}
          latestReply={latestReply}
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
      }
    />
  );
}
