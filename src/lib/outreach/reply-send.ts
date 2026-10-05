// Answering a reply from a pipeline's Sent & replies tab: the operator writes back to someone who
// replied to a pitch, and the app sends it from the pipeline's address as
// part of the same email thread. Never sent while outbound email is paused
// or to an address on the do-not-email list.
import { prisma } from "@/lib/db";
import { getSuppression } from "@/lib/email-suppression";
import { logError } from "@/lib/log";
import { classifySendError, sendReplyEmail } from "@/lib/send-email";
import { getAppSettings, pausedMessage, recordSendFailure } from "@/lib/outreach/settings";
import { getPipeline } from "@/lib/outreach/pipelines";
import { replyLeadId } from "@/lib/outreach/inbox";
import type { ActionResult } from "@/lib/outreach/lead-actions";
import type { PipelineId } from "@/lib/outreach/pipeline-id";
import { REPLY_MAX_LENGTH } from "@/lib/lead-forms";

/** "Re: <their subject>", without stacking "Re: Re:". */
export function replySubject(subject: string | null): string {
  const s = (subject ?? "").trim();
  if (!s) return "Re: your reply";
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

/** The inbound message's Message-ID as a header value ("<id>"), when the Worker passed one on. */
function inboundMessageId(dedupeKey: string): string | null {
  if (!dedupeKey.startsWith("mid:")) return null;
  const id = dedupeKey.slice(4).trim();
  return id ? `<${id}>` : null;
}

export async function sendInboxReply(pipelineId: PipelineId, inboundReplyId: string, rawBody: string): Promise<ActionResult> {
  const body = rawBody.replace(/\r\n/g, "\n").trim();
  if (!body) return { ok: false, error: "Write your reply first." };
  if (body.length > REPLY_MAX_LENGTH) {
    return {
      ok: false,
      error: `That reply is ${body.length.toLocaleString("en-US")} characters; the limit is ${REPLY_MAX_LENGTH.toLocaleString("en-US")}.`,
    };
  }

  const inbound = await prisma.inboundReply.findUnique({ where: { id: inboundReplyId } });
  const leadId = inbound && inbound.kind === "reply" ? replyLeadId(pipelineId, inbound) : null;
  if (!inbound || !leadId) return { ok: false, error: "That reply isn't in this pipeline's inbox any more — reload the page." };
  const pipeline = getPipeline(pipelineId);
  const lead = await pipeline.findLead(prisma, leadId);
  if (!lead) return { ok: false, error: "The lead this reply belongs to no longer exists." };

  const settings = await getAppSettings();
  if (settings.outboundPaused) return { ok: false, error: pausedMessage(settings) };
  const to = inbound.fromEmail.trim().toLowerCase();
  const suppression = await getSuppression(to);
  if (suppression) {
    return { ok: false, error: `${to} is on the do-not-email list (they asked not to be emailed), so nothing was sent.` };
  }

  const subject = replySubject(inbound.subject);
  let providerMessageId: string;
  try {
    ({ providerMessageId } = await sendReplyEmail(pipeline.senderEmail, to, subject, body, inboundMessageId(inbound.dedupeKey)));
  } catch (err) {
    const failure = classifySendError(err);
    logError("inbox.reply", err, { pipeline: pipelineId, leadId });
    if (failure.scope === "service") await recordSendFailure(failure.message);
    return { ok: false, error: failure.message };
  }

  // The email went out; from here a failure must not read as "nothing was sent".
  const sentAt = new Date();
  try {
    await prisma.$transaction(async (tx) => {
      await pipeline.addActivity(tx, leadId, {
        type: "email",
        date: sentAt,
        notes: `You replied from Sent & replies to ${to} — “${subject}”\n\n${body}`.slice(0, 4_000),
      });
      await pipeline.update(tx, leadId, { ourReplyAt: sentAt });
    });
  } catch (err) {
    logError("inbox.reply.record", err, { pipeline: pipelineId, leadId, providerMessageId });
    return { ok: true, message: `Sent your reply to ${to}, but it couldn't be added to ${lead.name}'s history.` };
  }
  return { ok: true, message: `Sent your reply to ${to}.` };
}
