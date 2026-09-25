// The cards for each pipeline's call deck: every lead on the cold-call
// list, with what the caller needs to know before dialling — who the
// business is, where (for the local time), when the pitch was emailed, and
// the latest entry in the lead's history.
//
// The order is stable (starred first, then oldest on the list first) and
// doesn't depend on updatedAt, which every saved call changes — so the
// deck's saved position still points at the same card after a refresh.
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/time";
import type { PipelineId } from "@/lib/outreach/pipeline-id";

export type CallDeckCard = {
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
};

const DECK_LIMIT = 200;
const NOTE_PREVIEW_CHARS = 280;

const ORDER = [{ starred: "desc" as const }, { createdAt: "asc" as const }, { id: "asc" as const }];
const LATEST_ACTIVITY = { activities: { orderBy: { date: "desc" as const }, take: 1 } };

function toCard(
  lead: {
    id: string;
    name: string;
    phone: string | null;
    city: string | null;
    state: string | null;
    lastEmailedAt: Date | null;
    activities: { date: Date; notes: string }[];
  },
  subtitle: string | null,
): CallDeckCard {
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
  };
}

export async function loadCallDeck(pipelineId: PipelineId): Promise<CallDeckCard[]> {
  if (pipelineId === "cold-outreach") {
    const leads = await prisma.lead.findMany({
      where: { status: "cold_call_list" },
      orderBy: ORDER,
      take: DECK_LIMIT,
      include: LATEST_ACTIVITY,
    });
    return leads.map((lead) => toCard(lead, lead.company));
  }
  const leads = await prisma.agentLead.findMany({
    where: { status: "cold_call_list" },
    orderBy: ORDER,
    take: DECK_LIMIT,
    include: LATEST_ACTIVITY,
  });
  return leads.map((lead) => toCard(lead, lead.brokerage));
}
