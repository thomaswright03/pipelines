// The Inbox page: every message the Cloudflare Email Worker passed on for
// the outreach address, whoever sent it — replies from leads, unmatched
// replies, automatic replies, bounces and mail from services (sign-in
// codes and the like) that the per-pipeline inboxes and Unmatched replies
// leave out. Read-only.
import { prisma } from "@/lib/db";
import { PIPELINE_BASE_PATH, PIPELINE_IDS, PIPELINE_LABEL } from "./pipeline-id";

/** The address Cloudflare Email Routing hands to the Worker. */
export const MAILBOX_ADDRESS = "thomas@wright-ai-solutions.com";

/** How many messages a page shows. */
export const MAILBOX_PAGE_SIZE = 100;

const MAILBOX_FILTERS = ["all", "people", "automatic", "bounces"] as const;
export type MailboxFilter = (typeof MAILBOX_FILTERS)[number];

export function parseMailboxFilter(value: unknown): MailboxFilter {
  return typeof value === "string" && (MAILBOX_FILTERS as readonly string[]).includes(value) ? (value as MailboxFilter) : "all";
}

export function parseMailboxPage(value: unknown): number {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  return Number.isFinite(n) && n > 1 ? n : 1;
}

const KIND_FOR: Record<MailboxFilter, string | undefined> = {
  all: undefined,
  people: "reply",
  automatic: "auto_reply",
  bounces: "bounce",
};

export type MailboxLead = { label: string; href: string };

export type MailboxMessage = {
  id: string;
  fromEmail: string;
  subject: string | null;
  text: string | null;
  kind: string;
  kindReason: string | null;
  verdict: string | null;
  optedOut: boolean;
  receivedAt: Date;
  /** The leads it was recorded on (or attached to), linked. */
  leads: MailboxLead[];
  /** "dismissed", "opted_out", "auto_reply" or null; an attach shows up in `leads`. */
  resolution: string | null;
};

export type Mailbox = {
  filter: MailboxFilter;
  page: number;
  counts: Record<MailboxFilter, number>;
  messages: MailboxMessage[];
};

/** Links for "pipeline:leadId" matches and an "attached:pipeline:leadId" resolution. */
export function mailboxLeads(matched: string[], resolution: string | null): MailboxLead[] {
  const refs = [...matched, ...(resolution?.startsWith("attached:") ? [resolution.slice("attached:".length)] : [])];
  const seen = new Set<string>();
  const leads: MailboxLead[] = [];
  for (const ref of refs) {
    const pipeline = PIPELINE_IDS.find((p) => ref.startsWith(`${p}:`));
    if (!pipeline || seen.has(ref)) continue;
    seen.add(ref);
    leads.push({ label: PIPELINE_LABEL[pipeline], href: `${PIPELINE_BASE_PATH[pipeline]}/${ref.slice(pipeline.length + 1)}` });
  }
  return leads;
}

export async function getMailbox(filter: MailboxFilter = "all", page = 1): Promise<Mailbox> {
  const kind = KIND_FOR[filter];
  const [all, people, automatic, bounces, rows] = await Promise.all([
    prisma.inboundReply.count(),
    prisma.inboundReply.count({ where: { kind: "reply" } }),
    prisma.inboundReply.count({ where: { kind: "auto_reply" } }),
    prisma.inboundReply.count({ where: { kind: "bounce" } }),
    prisma.inboundReply.findMany({
      where: kind ? { kind } : {},
      orderBy: { receivedAt: "desc" },
      skip: (page - 1) * MAILBOX_PAGE_SIZE,
      take: MAILBOX_PAGE_SIZE,
      select: {
        id: true,
        fromEmail: true,
        subject: true,
        text: true,
        kind: true,
        kindReason: true,
        verdict: true,
        optedOut: true,
        receivedAt: true,
        matched: true,
        resolution: true,
      },
    }),
  ]);
  return {
    filter,
    page,
    counts: { all, people, automatic, bounces },
    messages: rows.map((r) => ({
      id: r.id,
      fromEmail: r.fromEmail,
      subject: r.subject,
      text: r.text,
      kind: r.kind,
      kindReason: r.kindReason,
      verdict: r.verdict,
      optedOut: r.optedOut,
      receivedAt: r.receivedAt,
      leads: mailboxLeads(r.matched, r.resolution),
      resolution: r.resolution?.startsWith("attached:") ? null : r.resolution,
    })),
  };
}
