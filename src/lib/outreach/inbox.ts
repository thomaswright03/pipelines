// A pipeline's inbox: every email it sent, every send that failed, and
// every reply it got, read from the send log, the send ledger
// (OutreachRecipient) and the recorded inbound replies. Read-only.
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { PipelineId } from "./pipeline-id";

const INBOX_TABS = ["sent", "failed", "replied"] as const;
export type InboxTab = (typeof INBOX_TABS)[number];

/** How many rows a tab shows; the counts above the tabs are always complete. */
export const INBOX_LIMIT = 200;

export function parseInboxTab(value: unknown): InboxTab {
  return typeof value === "string" && (INBOX_TABS as readonly string[]).includes(value) ? (value as InboxTab) : "sent";
}

type LeadRef = { leadId: string | null; leadName: string | null };

type SentItem = LeadRef & { id: string; email: string; subject: string | null; sentAt: Date };

type FailedItem = LeadRef & {
  id: string;
  email: string;
  /** "bounced" | "refused" (the mail server refused the address) | "unknown" (delivery unconfirmed) | "failed" (the send errored) */
  kind: "bounced" | "refused" | "unknown" | "failed";
  detail: string | null;
  at: Date;
};

type RepliedItem = LeadRef & {
  id: string;
  email: string;
  subject: string | null;
  text: string | null;
  /** The classifier's verdict (reply-classifier.ts); "marked" for a lead marked replied by hand with no recorded reply. */
  verdict: string | null;
  at: Date;
  /** When you last replied to the lead (from Sent & replies, or marked by hand). */
  ourReplyAt: Date | null;
  /** The address is on the do-not-email list, so it can't be answered from here. */
  optedOut: boolean;
  /** A recorded reply that can be answered from Sent & replies (not a lead only marked replied by hand). */
  canReply: boolean;
  /** Opens the reply in Gmail: its Message-ID when the Worker passed one on, otherwise mail from the sender. */
  gmailUrl: string | null;
};

/** A Gmail search for one message (by Message-ID) or, without one, everything from the sender. */
export function gmailSearchUrl(dedupeKey: string | null, fromEmail: string): string | null {
  const messageId = dedupeKey?.startsWith("mid:") ? dedupeKey.slice(4).trim().replace(/^<|>$/g, "") : "";
  const query = messageId ? `rfc822msgid:${messageId}` : fromEmail ? `from:${fromEmail}` : "";
  return query ? `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(query)}` : null;
}

export type PipelineInbox = {
  tab: InboxTab;
  counts: Record<InboxTab, number>;
  sent: SentItem[];
  failed: FailedItem[];
  replied: RepliedItem[];
};

type LeadRow = {
  id: string;
  name: string;
  email: string | null;
  lastSendFailedAt: Date | null;
  lastSendFailure: string | null;
  ourReplyAt: Date | null;
};

// Each pipeline keeps leads and send logs in its own tables; this is
// the little the inbox needs from each.
function tables(pipelineId: PipelineId) {
  const select = { id: true, name: true, email: true, lastSendFailedAt: true, lastSendFailure: true, ourReplyAt: true } as const;
  if (pipelineId === "dataleadsell") {
    return {
      countLogs: (where: Prisma.EmailSendLogWhereInput) => prisma.emailSendLog.count({ where }),
      findLogs: (where: Prisma.EmailSendLogWhereInput, orderBy: Prisma.EmailSendLogOrderByWithRelationInput) =>
        prisma.emailSendLog.findMany({ where, orderBy, take: INBOX_LIMIT, include: { lead: { select: { name: true } } } }),
      findLeads: (where: Prisma.AgentLeadWhereInput): Promise<LeadRow[]> => prisma.agentLead.findMany({ where, select }),
      findLeadsFor: (where: Prisma.AgentLeadWhereInput, take: number) =>
        prisma.agentLead.findMany({ where, select: { ...select, repliedAt: true }, orderBy: { repliedAt: "desc" }, take }),
    };
  }
  if (pipelineId === "garbage-ai") {
    return {
      countLogs: (where: Prisma.HaulerEmailSendLogWhereInput) => prisma.haulerEmailSendLog.count({ where }),
      findLogs: (where: Prisma.HaulerEmailSendLogWhereInput, orderBy: Prisma.HaulerEmailSendLogOrderByWithRelationInput) =>
        prisma.haulerEmailSendLog.findMany({ where, orderBy, take: INBOX_LIMIT, include: { lead: { select: { name: true } } } }),
      findLeads: (where: Prisma.HaulerLeadWhereInput): Promise<LeadRow[]> => prisma.haulerLead.findMany({ where, select }),
      findLeadsFor: (where: Prisma.HaulerLeadWhereInput, take: number) =>
        prisma.haulerLead.findMany({ where, select: { ...select, repliedAt: true }, orderBy: { repliedAt: "desc" }, take }),
    };
  }
  return {
    countLogs: (where: Prisma.LeadEmailSendLogWhereInput) => prisma.leadEmailSendLog.count({ where }),
    findLogs: (where: Prisma.LeadEmailSendLogWhereInput, orderBy: Prisma.LeadEmailSendLogOrderByWithRelationInput) =>
      prisma.leadEmailSendLog.findMany({ where, orderBy, take: INBOX_LIMIT, include: { lead: { select: { name: true } } } }),
    findLeads: (where: Prisma.LeadWhereInput): Promise<LeadRow[]> => prisma.lead.findMany({ where, select }),
    findLeadsFor: (where: Prisma.LeadWhereInput, take: number) =>
      prisma.lead.findMany({ where, select: { ...select, repliedAt: true }, orderBy: { repliedAt: "desc" }, take }),
  };
}

function replyWhere(pipelineId: PipelineId) {
  const prefix = `${pipelineId}:%`;
  const attached = `attached:${pipelineId}:%`;
  return Prisma.sql`"kind" = 'reply' AND (EXISTS (SELECT 1 FROM unnest("matched") m WHERE m LIKE ${prefix}) OR "resolution" LIKE ${attached})`;
}

/** Replies a person wrote that were recorded on (or attached to) one of this pipeline's leads, newest first. */
async function replyRows(pipelineId: PipelineId) {
  const where = replyWhere(pipelineId);
  const [rows, total] = await Promise.all([
    prisma.$queryRaw<{ id: string }[]>`SELECT "id" FROM "InboundReply" WHERE ${where} ORDER BY "receivedAt" DESC LIMIT ${INBOX_LIMIT}`,
    prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM "InboundReply" WHERE ${where}`,
  ]);
  const replies = rows.length
    ? await prisma.inboundReply.findMany({ where: { id: { in: rows.map((r) => r.id) } }, orderBy: { receivedAt: "desc" } })
    : [];
  return { replies, total: Number(total[0]?.n ?? 0) };
}

/** The lead a reply belongs to in this pipeline, from its "pipeline:leadId" matches or its attach resolution. */
export function replyLeadId(pipelineId: PipelineId, reply: { matched: string[]; resolution: string | null }): string | null {
  const hit = reply.matched.find((m) => m.startsWith(`${pipelineId}:`));
  if (hit) return hit.slice(pipelineId.length + 1);
  const attachedPrefix = `attached:${pipelineId}:`;
  if (reply.resolution?.startsWith(attachedPrefix)) return reply.resolution.slice(attachedPrefix.length);
  return null;
}

export async function getPipelineInbox(pipelineId: PipelineId, tab: InboxTab = "sent"): Promise<PipelineInbox> {
  const t = tables(pipelineId);

  // Failed: bounced sends, addresses the ledger holds as refused or
  // unconfirmed, and leads whose latest send errored (cleared by a later
  // success). One row per address; the ledger's reason wins.
  const [bouncedLogs, ledgerFailures, erroredLeads] = await Promise.all([
    t.findLogs({ bounced: true }, { bouncedAt: "desc" }),
    prisma.outreachRecipient.findMany({
      where: { pipeline: pipelineId, state: { in: ["refused", "unknown"] } },
      orderBy: { claimedAt: "desc" },
    }),
    t.findLeads({ lastSendFailedAt: { not: null } }),
  ]);
  const ledgerLeadIds = ledgerFailures.map((r) => r.leadId).filter((id): id is string => !!id);
  const ledgerLeads = new Map((ledgerLeadIds.length ? await t.findLeads({ id: { in: ledgerLeadIds } }) : []).map((l) => [l.id, l]));

  const failed: FailedItem[] = [];
  const failedEmails = new Set<string>();
  for (const r of ledgerFailures) {
    failedEmails.add(r.email);
    failed.push({
      id: `ledger:${r.id}`,
      email: r.email,
      kind: r.state === "refused" ? "refused" : "unknown",
      detail: r.lastError,
      at: r.claimedAt,
      leadId: r.leadId,
      leadName: r.leadId ? (ledgerLeads.get(r.leadId)?.name ?? null) : null,
    });
  }
  for (const log of bouncedLogs) {
    const email = log.email.toLowerCase();
    if (failedEmails.has(email)) continue;
    failedEmails.add(email);
    failed.push({
      id: `bounce:${log.id}`,
      email,
      kind: "bounced",
      detail: log.subject,
      at: log.bouncedAt ?? log.sentAt,
      leadId: log.leadId,
      leadName: log.lead?.name ?? null,
    });
  }
  for (const lead of erroredLeads) {
    const email = lead.email?.toLowerCase() ?? "";
    if (email && failedEmails.has(email)) continue;
    if (email) failedEmails.add(email);
    failed.push({
      id: `lead:${lead.id}`,
      email,
      kind: "failed",
      detail: lead.lastSendFailure,
      at: lead.lastSendFailedAt!,
      leadId: lead.id,
      leadName: lead.name,
    });
  }
  failed.sort((a, b) => b.at.getTime() - a.at.getTime());

  // Sent: every send the provider accepted and that hasn't bounced.
  const [sentLogs, sentCount] = await Promise.all([
    tab === "sent" ? t.findLogs({ bounced: false }, { sentAt: "desc" }) : Promise.resolve([]),
    t.countLogs({ bounced: false }),
  ]);
  const sent: SentItem[] = sentLogs.map((log) => ({
    id: log.id,
    email: log.email,
    subject: log.subject,
    sentAt: log.sentAt,
    leadId: log.leadId,
    leadName: log.lead?.name ?? null,
  }));

  // Replied: recorded replies, plus leads marked replied by hand that have
  // no recorded reply (e.g. they answered by phone or from another inbox).
  const { replies, total: replyTotal } = await replyRows(pipelineId);
  const replyLeadIds = replies.map((r) => replyLeadId(pipelineId, r)).filter((id): id is string => !!id);
  const [replyLeads, allReplyLeadIds] = await Promise.all([
    replyLeadIds.length ? t.findLeads({ id: { in: replyLeadIds } }) : Promise.resolve([]),
    allRepliedLeadIds(pipelineId),
  ]);
  const replyLeadsById = new Map(replyLeads.map((l) => [l.id, l]));
  const markedLeads = await t.findLeadsFor({ repliedAt: { not: null }, id: { notIn: [...allReplyLeadIds] } }, INBOX_LIMIT);
  const replyEmails = [...new Set(replies.map((r) => r.fromEmail.toLowerCase()))];
  const optedOut = new Set(
    (replyEmails.length
      ? await prisma.suppressedEmail.findMany({ where: { email: { in: replyEmails } }, select: { email: true } })
      : []
    ).map((r) => r.email),
  );
  const replied: RepliedItem[] = replies.map((r) => {
    const leadId = replyLeadId(pipelineId, r);
    const lead = leadId ? replyLeadsById.get(leadId) : undefined;
    return {
      id: r.id,
      email: r.fromEmail,
      subject: r.subject,
      text: r.text,
      verdict: r.verdict,
      at: r.receivedAt,
      leadId,
      leadName: lead?.name ?? null,
      ourReplyAt: lead?.ourReplyAt ?? null,
      optedOut: optedOut.has(r.fromEmail.toLowerCase()),
      canReply: !!lead,
      gmailUrl: gmailSearchUrl(r.dedupeKey, r.fromEmail),
    };
  });
  for (const lead of markedLeads) {
    replied.push({
      id: `marked:${lead.id}`,
      email: lead.email ?? "",
      subject: null,
      text: null,
      verdict: "marked",
      at: lead.repliedAt!,
      leadId: lead.id,
      leadName: lead.name,
      ourReplyAt: lead.ourReplyAt,
      optedOut: false,
      canReply: false,
      gmailUrl: gmailSearchUrl(null, lead.email ?? ""),
    });
  }
  replied.sort((a, b) => b.at.getTime() - a.at.getTime());

  return {
    tab,
    counts: { sent: sentCount, failed: failed.length, replied: replyTotal + markedLeads.length },
    sent,
    failed: failed.slice(0, INBOX_LIMIT),
    replied: replied.slice(0, INBOX_LIMIT),
  };
}

/** Every lead id in this pipeline with at least one recorded reply (not capped, so hand-marked leads aren't double-counted). */
async function allRepliedLeadIds(pipelineId: PipelineId): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<{ matched: string[]; resolution: string | null }[]>`
    SELECT "matched", "resolution" FROM "InboundReply" WHERE ${replyWhere(pipelineId)}`;
  return new Set(rows.map((r) => replyLeadId(pipelineId, r)).filter((id): id is string => !!id));
}
