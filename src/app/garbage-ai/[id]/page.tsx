import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import LeadActions from "@/components/LeadActions";
import { DetailField, LeadPageLayout } from "@/components/LeadDetailParts";
import { getPipeline } from "@/lib/outreach/pipelines";
import { loadLeadContext } from "@/lib/lead-page";
import { templateVersionHistory } from "@/lib/template-versions";
import { formatDate, formatDateTime } from "@/lib/time";
import { formatCents } from "@/lib/format";
import { CALL_OUTCOME_LABEL } from "@/lib/lead-status";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // "Find email" guesses a website first, which can take a few tries.

export async function generateMetadata({ params }: PageProps<"/garbage-ai/[id]">): Promise<Metadata> {
  const { id } = await params;
  const lead = await prisma.haulerLead.findUnique({ where: { id }, select: { name: true } });
  return { title: lead ? `${lead.name} — Garbage AI` : "Not found — Garbage AI" };
}

export default async function HaulerDetail({ params }: PageProps<"/garbage-ai/[id]">) {
  const { id } = await params;
  const lead = await prisma.haulerLead.findUnique({
    where: { id },
    include: {
      emailLogs: { orderBy: { sentAt: "desc" } },
      activities: { orderBy: { date: "desc" } },
    },
  });
  if (!lead) notFound();

  const pipeline = getPipeline("garbage-ai");
  const [{ suppression, paused, ledgerNote, latestReply }, versionHistory] = await Promise.all([
    loadLeadContext("garbage-ai", lead.id, lead.email),
    templateVersionHistory("garbage-ai"),
  ]);
  // Exactly what a send would use.
  const preview = pipeline.buildEmail({ name: lead.name, company: lead.company, county: null });

  return (
    <LeadPageLayout
      pipeline="garbage-ai"
      back={{ href: "/garbage-ai", label: "All haulers" }}
      lead={lead}
      subtitle={lead.company && lead.company !== lead.name ? lead.company : null}
      detailsLabel="Hauler details"
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
          <DetailField label="Services (Yelp)" value={lead.services ?? "—"} />
          <DetailField label="Address" value={lead.address ?? "—"} />
          <DetailField label="City/State" value={lead.city ? [lead.city, lead.state].filter(Boolean).join(", ") : "—"} />
          <DetailField label="Website" value={lead.website ?? "—"} href={lead.website ?? undefined} />
          <DetailField label="Source" value={lead.source ?? "—"} />
          <DetailField label="Added" value={formatDate(lead.createdAt)} />
          <DetailField label="Last emailed" value={formatDateTime(lead.lastEmailedAt)} />
          <DetailField label="Replied" value={formatDateTime(lead.repliedAt)} />
          <DetailField label="We replied back" value={formatDateTime(lead.ourReplyAt)} />
          <DetailField label="Call outcome" value={lead.callOutcome ? (CALL_OUTCOME_LABEL[lead.callOutcome] ?? lead.callOutcome) : "—"} />
          <DetailField label="Estimated value" value={formatCents(lead.estimatedValueCents)} />
        </>
      }
      actions={
        <LeadActions
          pipeline="garbage-ai"
          paused={paused}
          sendHold={pipeline.sendHold}
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
