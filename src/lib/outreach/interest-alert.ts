// Anyone who shows interest in a pitch gets Thomas a phone call: the reply
// handler (/api/email-inbound) calls alertInterest for every new reply the
// rules read as "positive", and Hitta is sent an urgent report naming who
// replied, about which product, what they said and how to reach them.
//
// The report is stored on the InboundReply row before it is sent, and the
// send is recorded there too (interestAlertedAt on a 201, interestAlertError
// otherwise), so a report Hitta didn't get is never lost: the CSO job
// (thomaswright03/Chief-Sales-Officer) resends every stored report that has
// no interestAlertedAt. A failure here never fails the reply itself.
import { prisma } from "@/lib/db";
import { logWarn } from "@/lib/log";
import { sendHittaReport, type HittaReport, type HittaResult } from "@/lib/hitta";
import { ALL_PIPELINES, type OutreachLead } from "@/lib/outreach/pipelines";
import type { PipelineId } from "@/lib/outreach/pipeline-id";

/** What each pipeline sells, as Thomas would say it. */
export const PRODUCT_NAME: Record<PipelineId, string> = {
  dataleadsell: "the Probate Property Leads subscription",
  "cold-outreach": "custom software from Wright AI Solutions",
  "garbage-ai": "Garbage AI, the AI that texts back haulers' leads",
};

/** The name Hitta should say for the project that sent the report. */
export const HITTA_PROJECT = "Chief Sales Officer";

const MAX_QUOTE_CHARS = 280;

type MatchedLead = { pipeline: PipelineId; lead: OutreachLead };

/** Reads a phone number digit by digit, so Hitta doesn't say it as one large number. */
function speakablePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 7 ? digits.split("").join(" ") : phone;
}

/** The replier's words, trimmed to a sentence or two, without characters that read badly aloud. */
function quote(text: string | null): string | null {
  const clean = (text ?? "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_#>`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return null;
  return clean.length > MAX_QUOTE_CHARS ? `${clean.slice(0, MAX_QUOTE_CHARS).replace(/\s+\S*$/, "")}…` : clean;
}

/**
 * The urgent report for an interested reply. Plain sentences only (Hitta
 * reads it aloud). `reason` replaces the default "replied with interest"
 * wording, e.g. for a reply the CSO read as interested.
 */
export function buildInterestReport(
  reply: { fromEmail: string; subject: string | null; text: string | null },
  matches: MatchedLead[],
  reason?: string,
): HittaReport {
  const first = matches[0];
  const said = quote(reply.text);
  if (!first) {
    return {
      project: HITTA_PROJECT,
      title: `Someone replied with interest from ${reply.fromEmail}`,
      summary: [
        `A reply from ${reply.fromEmail} reads as interested, but no lead in Pipelines has that address.`,
        said ? `They wrote: ${said}` : null,
        `Find it under Unmatched replies in Pipelines, attach it to the right lead, and get back to them.`,
      ]
        .filter(Boolean)
        .join(" "),
      urgency: "urgent",
    };
  }
  const { lead } = first;
  const who =
    lead.company && lead.company.trim().toLowerCase() !== lead.name.trim().toLowerCase() ? `${lead.name} at ${lead.company}` : lead.name;
  const place = [lead.city, lead.state].filter(Boolean).join(", ");
  const products = [...new Set(matches.map((m) => PRODUCT_NAME[m.pipeline]))];
  return {
    project: HITTA_PROJECT,
    title: `${who} is interested in ${products[0]}`,
    summary: [
      `${who}${place ? ` in ${place}` : ""} ${reason ?? "replied to the pitch with interest"}${products.length > 1 ? ` (they were pitched ${products.join(" and ")})` : ""}.`,
      said ? `They wrote: ${said}` : null,
      lead.phone
        ? `Their phone number is ${speakablePhone(lead.phone)}, and their email is ${reply.fromEmail}.`
        : `There's no phone number on file; their email is ${reply.fromEmail}.`,
      `Get back to them while they're warm.`,
    ]
      .filter(Boolean)
      .join(" "),
    urgency: "urgent",
  };
}

/** The leads a stored reply landed on ("pipeline:leadId"). */
export async function matchedLeads(matched: string[]): Promise<MatchedLead[]> {
  const found: MatchedLead[] = [];
  for (const key of matched) {
    const [pipelineId, leadId] = key.split(":");
    const pipeline = ALL_PIPELINES.find((p) => p.id === pipelineId);
    if (!pipeline || !leadId) continue;
    const lead = await pipeline.findLead(prisma, leadId);
    if (lead) found.push({ pipeline: pipeline.id, lead });
  }
  return found;
}

/**
 * Builds, stores and sends the urgent report for an interested reply. Sent
 * at most once: a reply already confirmed by Hitta is left alone. Never
 * throws; the outcome is on the row and in the log.
 */
export async function alertInterest(replyId: string, fetchImpl: typeof fetch = fetch): Promise<HittaResult | null> {
  try {
    const reply = await prisma.inboundReply.findUnique({ where: { id: replyId } });
    if (!reply || reply.interestAlertedAt) return null;
    const report = reply.interestReport
      ? (JSON.parse(reply.interestReport) as HittaReport)
      : buildInterestReport(reply, await matchedLeads(reply.matched));
    const result = await sendHittaReport(report, fetchImpl);
    await prisma.inboundReply.update({
      where: { id: replyId },
      data: {
        interestReport: JSON.stringify(report),
        interestAlertedAt: result.ok ? new Date() : null,
        interestAlertError: result.ok ? null : result.message,
      },
    });
    if (!result.ok) logWarn("outreach.interest-alert", `Hitta didn't get the interest report: ${result.message}`, { replyId });
    return result;
  } catch (err) {
    logWarn("outreach.interest-alert", `Couldn't send the interest report: ${err instanceof Error ? err.message : String(err)}`, {
      replyId,
    });
    return null;
  }
}
