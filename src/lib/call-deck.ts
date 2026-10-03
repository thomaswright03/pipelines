// The cards for each pipeline's call deck: every lead on the cold-call
// list, with what the caller needs to know before dialling — who the
// business is, where (for the local time), when the pitch was emailed, the
// latest entry in the lead's history, and whether a reply from them is
// still waiting for the operator's look (a possible "no" or complaint).
//
// The order is stable (starred first, then oldest on the list first) and
// doesn't depend on updatedAt, which every saved call changes — so the
// deck's saved position still points at the same card after a refresh.
//
// A deck holds at most DECK_LIMIT cards. The rest of the list is reached a
// batch at a time with a keyset cursor (the last card of the batch before),
// so leads leaving the list while the caller works never skip anyone.
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/time";
import type { PipelineId } from "@/lib/outreach/pipeline-id";

type CallDeckCard = {
  id: string;
  name: string;
  /** Company (Cold Outreach) or brokerage (dataleadsell). */
  subtitle: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  /** "Emailed Sep 18, 2026", or "Never emailed". */
  emailed: string;
  /** The latest history entry (reply, call, note), shortened. */
  lastNote: { date: string; text: string } | null;
  /** Why a reply from this lead needs the operator's look before calling, or null. */
  review: string | null;
};

export type CallDeck = {
  cards: CallDeckCard[];
  /** Everyone on the cold-call list right now. */
  total: number;
  /** How many of the list come before this batch (0 for the first). */
  offset: number;
  /** Cursor for the next batch (the last card's id), or null when this batch reaches the end of the list. */
  nextAfter: string | null;
};

const DECK_LIMIT = 200;
const NOTE_PREVIEW_CHARS = 280;

const ON_LIST = { status: "cold_call_list" } as const;
const ORDER = [{ starred: "desc" as const }, { createdAt: "asc" as const }, { id: "asc" as const }];
const LATEST_ACTIVITY = { activities: { orderBy: { date: "desc" as const }, take: 1 } };

type DeckRow = {
  id: string;
  name: string;
  phone: string | null;
  city: string | null;
  state: string | null;
  lastEmailedAt: Date | null;
  replyNeedsReview: boolean;
  replyReviewReason: string | null;
  starred: boolean;
  createdAt: Date;
  company?: string | null;
  brokerage?: string | null;
  activities: { date: Date; notes: string }[];
};
type Where = Prisma.LeadWhereInput & Prisma.AgentLeadWhereInput;
// Every lead table has every column read here; arguments are valid for each.
type DeckTable = {
  findMany(args: Prisma.LeadFindManyArgs & Prisma.AgentLeadFindManyArgs): Promise<DeckRow[]>;
  findUnique(args: Prisma.LeadFindUniqueArgs & Prisma.AgentLeadFindUniqueArgs): Promise<DeckRow | null>;
  count(args: Prisma.LeadCountArgs & Prisma.AgentLeadCountArgs): Promise<number>;
};

function table(pipelineId: PipelineId): DeckTable {
  const tables = { "cold-outreach": prisma.lead, "garbage-ai": prisma.haulerLead, dataleadsell: prisma.agentLead };
  return tables[pipelineId] as unknown as DeckTable;
}

/** Leads that sort after `cursor` in ORDER. */
function after(cursor: Pick<DeckRow, "id" | "starred" | "createdAt">): Where {
  return {
    OR: [
      ...(cursor.starred ? [{ starred: false }] : []),
      { starred: cursor.starred, createdAt: { gt: cursor.createdAt } },
      { starred: cursor.starred, createdAt: cursor.createdAt, id: { gt: cursor.id } },
    ],
  };
}

function toCard(lead: DeckRow, subtitle: string | null): CallDeckCard {
  const note = lead.activities[0];
  const text = note?.notes.replace(/\s+/g, " ").trim() ?? "";
  return {
    id: lead.id,
    name: lead.name,
    subtitle,
    phone: lead.phone,
    city: lead.city,
    state: lead.state,
    emailed: lead.lastEmailedAt ? `Emailed ${formatDate(lead.lastEmailedAt)}` : "Never emailed",
    lastNote: note
      ? { date: formatDate(note.date), text: text.length > NOTE_PREVIEW_CHARS ? `${text.slice(0, NOTE_PREVIEW_CHARS)}…` : text }
      : null,
    review: lead.replyNeedsReview ? (lead.replyReviewReason ?? "A reply from this lead hasn't been reviewed yet.") : null,
  };
}

/**
 * One batch of the call deck: the first DECK_LIMIT leads on the list, or,
 * with `afterId`, the ones after that lead. An `afterId` that no longer
 * exists starts from the top again.
 */
export async function loadCallDeck(pipelineId: PipelineId, options: { afterId?: string; limit?: number } = {}): Promise<CallDeck> {
  const leads = table(pipelineId);
  const limit = options.limit ?? DECK_LIMIT;
  const cursor = options.afterId ? await leads.findUnique({ where: { id: options.afterId } }) : null;
  const where: Where = cursor ? { AND: [ON_LIST, after(cursor)] } : ON_LIST;
  const [rows, total, remaining] = await Promise.all([
    leads.findMany({ where, orderBy: ORDER, take: limit, include: LATEST_ACTIVITY }),
    leads.count({ where: ON_LIST }),
    cursor ? leads.count({ where }) : null,
  ]);
  const fromHere = remaining ?? total;
  const last = rows.at(-1);
  return {
    cards: rows.map((lead) => toCard(lead, pipelineId === "dataleadsell" ? (lead.brokerage ?? null) : (lead.company ?? null))),
    total,
    offset: total - fromHere,
    nextAfter: last && fromHere > rows.length ? last.id : null,
  };
}
