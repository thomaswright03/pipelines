// Data every lead page needs besides the lead itself: its address's
// do-not-email entry, what the send ledger knows about it, and whether
// outbound email is paused.
import { prisma } from "@/lib/db";
import { getSuppression } from "@/lib/email-suppression";
import { getAppSettings } from "@/lib/outreach/settings";
import { formatDate, formatDateTime } from "@/lib/time";
import type { PipelineId } from "@/lib/outreach/pipeline-id";
import type { LeadSuppression } from "@/components/LeadActions";

export type LedgerNote = { tone: "warning" | "info"; text: string } | null;

export async function loadLeadContext(pipeline: PipelineId, leadId: string, email: string | null) {
  const [suppression, settings, ledger] = await Promise.all([
    email ? getSuppression(email) : null,
    getAppSettings(),
    email ? prisma.outreachRecipient.findMany({ where: { email: email.toLowerCase() } }) : [],
  ]);

  const lead: LeadSuppression | null = suppression
    ? {
        source: suppression.source,
        evidence: suppression.evidence,
        reason: suppression.reason,
        since: formatDate(suppression.createdAt),
      }
    : null;

  let ledgerNote: LedgerNote = null;
  const own = ledger.find((r) => r.pipeline === pipeline && r.leadId === leadId);
  const other = ledger.find((r) => !(r.pipeline === pipeline && r.leadId === leadId));
  if (own?.state === "unknown") {
    ledgerNote = {
      tone: "warning",
      text: `The connection to the email service dropped while sending on ${formatDateTime(own.claimedAt)}, so it's unknown whether the email arrived. It won't be sent again automatically.`,
    };
  } else if (own?.state === "claimed") {
    ledgerNote = {
      tone: "warning",
      text: `A send started on ${formatDateTime(own.claimedAt)} never finished recording. It is treated as sent, so this address won't be pitched again.`,
    };
  } else if (!own && other) {
    ledgerNote = {
      tone: "info",
      text: `This address was already pitched ${other.pipeline === pipeline ? "via another lead in this pipeline" : `by the ${other.pipeline === "dataleadsell" ? "dataleadsell.com" : "Cold Outreach"} pipeline`} on ${formatDate(other.claimedAt)}.`,
    };
  }

  return { suppression: lead, paused: settings.outboundPaused, ledgerNote };
}
