// The reply-loop check (Settings → Connections): proves, after a deploy,
// that a pitch leaves, that a reply to it comes back through the email
// Worker, and that the reply is recorded on the right lead — using the real
// path end to end, nothing simulated.
//
// "Send a test pitch" creates a Cold Outreach lead named "Reply check"
// with an address the owner controls and sends it the real pitch
// (sendFirstTouch: the kill switch, the do-not-email list and the
// one-pitch-per-address rule all apply). The owner replies from that inbox;
// the reply is handled like any other (inbound.ts). The panel then shows
// what happened: pitch sent, reply recorded, how it was read, and where the
// lead is now. Each address gets one pitch, so a repeat check needs a new
// address — a plus-address (you+check2@example.com) works.
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getAppSettings, pausedMessage } from "@/lib/outreach/settings";
import { checkAddressForLead } from "@/lib/outreach/lead-edit";
import { enteredByHandEvidence } from "@/lib/outreach/evidence";
import { sendFirstTouch } from "@/lib/outreach/send";
import type { ActionResult } from "@/lib/outreach/lead-actions";

/** The source of every reply-check lead, so they can be listed (and told apart from prospects). */
export const REPLY_CHECK_SOURCE = "Reply check (Settings)";
const REPLY_CHECK_NAME = "Reply check";

/** How long after the pitch a missing reply is worth pointing out, if the owner has replied. */
export const REPLY_CHECK_PATIENCE_MS = 15 * 60_000;

export async function startReplyCheck(rawEmail: string): Promise<ActionResult & { leadId?: string }> {
  const email = String(rawEmail ?? "")
    .trim()
    .toLowerCase();
  if (!z.email().safeParse(email).success) return { ok: false, error: "Enter a full email address you can read, like you@example.com." };

  const settings = await getAppSettings();
  if (settings.outboundPaused) return { ok: false, error: pausedMessage(settings) };
  const problem = await checkAddressForLead("cold-outreach", email);
  if (problem) {
    return {
      ok: false,
      error: `${problem.message} For another check, use a new address — a plus-address such as ${plusAddress(email)} reaches the same inbox.`,
    };
  }

  const lead = await prisma.lead.create({
    data: {
      name: REPLY_CHECK_NAME,
      company: REPLY_CHECK_NAME,
      email,
      emailEvidence: enteredByHandEvidence(),
      source: REPLY_CHECK_SOURCE,
      notes: "Created by the reply-loop check in Settings → Connections. Delete it once the check is done.",
    },
  });
  const sent = await sendFirstTouch("cold-outreach", lead.id);
  if (!sent.ok) return { ok: false, leadId: lead.id, error: `The test pitch wasn't sent: ${sent.message}` };
  return {
    ok: true,
    leadId: lead.id,
    message: `Sent the Cold Outreach pitch to ${email}. Reply to it from that inbox (try “Yes, interested” or “STOP”), then come back here — the result shows within a few minutes.`,
  };
}

function plusAddress(email: string): string {
  const [local, domain] = email.split("@");
  return `${local!.split("+")[0]}+check${Math.floor(Date.now() / 1000) % 1000}@${domain}`;
}

type CheckState = "not_sent" | "waiting" | "late" | "recorded";

export type ReplyCheckView = {
  leadId: string;
  email: string;
  state: CheckState;
  sentAt: Date | null;
  /** The lead's status now (Responded after an interested reply, Lost after a STOP). */
  status: string;
  reply: { receivedAt: Date; verdict: string | null; kind: string; optedOut: boolean } | null;
};

/** The latest reply-loop checks, newest first, with what happened to each. */
export async function listReplyChecks(take = 3, now: Date = new Date()): Promise<ReplyCheckView[]> {
  const leads = await prisma.lead.findMany({
    where: { source: REPLY_CHECK_SOURCE },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, email: true, status: true, lastEmailedAt: true },
  });
  return Promise.all(
    leads.map(async (lead) => {
      const reply = await prisma.inboundReply.findFirst({
        where: { matched: { has: `cold-outreach:${lead.id}` } },
        orderBy: { receivedAt: "desc" },
        select: { receivedAt: true, verdict: true, kind: true, optedOut: true },
      });
      const sentAt = lead.lastEmailedAt;
      const state: CheckState = reply
        ? "recorded"
        : !sentAt
          ? "not_sent"
          : now.getTime() - sentAt.getTime() > REPLY_CHECK_PATIENCE_MS
            ? "late"
            : "waiting";
      return { leadId: lead.id, email: lead.email ?? "", state, sentAt, status: lead.status, reply };
    }),
  );
}
