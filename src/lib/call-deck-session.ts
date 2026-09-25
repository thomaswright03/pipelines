// Where the caller is in the call deck survives a refresh (per browser tab):
// the cards already worked this session and what was recorded for each.
// Browser storage can be missing or throw (private windows, blocked site
// data), so the deck works without it — it just starts from the top.
// Kept apart from the component so restoring is unit-tested
// (tests/call-deck-session.test.ts).
import type { ColdCallOutcome } from "@/lib/lead-status";
import type { PipelineId } from "@/lib/outreach/pipeline-id";

export type LoggedCall = { lead: { id: string; name: string }; outcome: ColdCallOutcome | "skipped" };
export type SavedDeck = { handled: string[]; log: LoggedCall[] };

/** The part of the Storage API the deck uses (sessionStorage in the browser). */
export type DeckStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storageKey(pipeline: PipelineId) {
  return `call-deck:${pipeline}`;
}

function isLoggedCall(value: unknown): value is LoggedCall {
  const v = value as LoggedCall | null;
  return typeof v?.lead?.id === "string" && typeof v.lead.name === "string" && typeof v.outcome === "string";
}

/** This tab's saved progress, or null when there is none, it's unreadable, or storage is unavailable. */
export function readSavedDeck(storage: DeckStorage | null, pipeline: PipelineId): SavedDeck | null {
  try {
    const raw = storage?.getItem(storageKey(pipeline));
    if (!raw) return null;
    const saved = JSON.parse(raw) as Partial<SavedDeck>;
    if (!Array.isArray(saved.handled) || !Array.isArray(saved.log)) return null;
    return { handled: saved.handled.filter((id): id is string => typeof id === "string"), log: saved.log.filter(isLoggedCall) };
  } catch {
    return null;
  }
}

/** Saves (or, with null, forgets) this tab's progress. Never throws. */
export function writeSavedDeck(storage: DeckStorage | null, pipeline: PipelineId, saved: SavedDeck | null): void {
  try {
    if (saved) storage?.setItem(storageKey(pipeline), JSON.stringify(saved));
    else storage?.removeItem(storageKey(pipeline));
  } catch {
    // Not saved: a refresh starts the deck from the top.
  }
}

/** The first card not yet worked this session (the deck's length when all are done). */
export function firstUnhandled(leads: { id: string }[], handled: string[]): number {
  const done = new Set(handled);
  const index = leads.findIndex((lead) => !done.has(lead.id));
  return index === -1 ? leads.length : index;
}

/** Records one worked card: the new log and what to save. */
export function recordCall(log: LoggedCall[], entry: LoggedCall): SavedDeck {
  const nextLog = [...log, { lead: { id: entry.lead.id, name: entry.lead.name }, outcome: entry.outcome }];
  return { handled: nextLog.map((e) => e.lead.id), log: nextLog };
}

/** sessionStorage, or null where reading it throws (blocked site data). */
export function sessionDeckStorage(): DeckStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
