"use client";

import { useEffect, useState } from "react";
import { confirmColdCallAction, type ColdCallOutcome } from "@/lib/actions/vault-pipeline";
import { getTimezoneForState, formatLocalTime } from "@/lib/us-timezones";

const CLOCK_TICK_MS = 30_000;

/** Live clock, ticking on an interval — so "what time is it there" stays accurate on a card left open a while. */
function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export type ColdCallLead = { id: string; name: string; phone: string | null; city: string | null; state: string | null };

const OUTCOMES: { value: ColdCallOutcome; label: string; activeClass: string }[] = [
  { value: "no_answer", label: "Didn't Answer", activeClass: "border-zinc-500 bg-zinc-500 text-white" },
  { value: "invalid_number", label: "Invalid Number", activeClass: "border-zinc-500 bg-zinc-500 text-white" },
  { value: "not_interested", label: "Not Interested", activeClass: "border-red-500 bg-red-500 text-white" },
  { value: "interested", label: "Interested", activeClass: "border-emerald-500 bg-emerald-500 text-white" },
];

// One card at a time — confirming an outcome advances to the next card,
// purely locally (the index) independent of whatever status the confirm
// landed on: a "Didn't Answer" lead stays in Cold Call List for another
// day, but this session still moves past it instead of re-showing it.
export default function ColdCallFlashcards({ leads }: { leads: ColdCallLead[] }) {
  const [index, setIndex] = useState(0);
  const [outcome, setOutcome] = useState<ColdCallOutcome | null>(null);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = useNow(CLOCK_TICK_MS);

  const current = leads[index];

  async function confirm() {
    if (!outcome) {
      setError("Pick an outcome before confirming.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await confirmColdCallAction(current.id, outcome, notes);
      setIndex((i) => i + 1);
      setOutcome(null);
      setNotes("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that — try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (leads.length === 0) {
    return (
      <div className="card p-8 text-center">
        <p className="text-sm text-zinc-500">No leads in the Cold Call List right now.</p>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="card flex flex-col items-center gap-2 p-10 text-center">
        <span className="accent-text text-3xl font-bold">🎉</span>
        <p className="text-sm font-medium">All done — worked through {leads.length} calls.</p>
        <p className="text-xs text-zinc-500">Refresh the page for anything new since you started.</p>
      </div>
    );
  }

  const timezone = getTimezoneForState(current.state);
  const localTimeLabel = timezone ? formatLocalTime(now, timezone) : null;

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex items-center gap-3">
        <p className="text-xs font-medium text-zinc-500">
          Card {index + 1} of {leads.length}
        </p>
        <div className="h-1.5 w-32 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-300"
            style={{ width: `${(index / leads.length) * 100}%` }}
          />
        </div>
      </div>

      <div className="card w-full max-w-md p-8 shadow-lg shadow-indigo-500/5">
        <h2 className="text-center text-2xl font-bold">{current.name}</h2>

        <div className="mt-4 flex flex-col items-center gap-1.5">
          {current.phone ? (
            <a href={`tel:${current.phone}`} className="inline-flex items-center gap-2 text-lg font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400">
              {current.phone}
            </a>
          ) : (
            <span className="text-sm text-zinc-500">No phone on file</span>
          )}
          {(current.city || current.state) && (
            <span className="text-sm text-zinc-500">{[current.city, current.state].filter(Boolean).join(", ")}</span>
          )}
          {localTimeLabel && <span className="text-xs text-zinc-400">{localTimeLabel} there</span>}
          {current.phone && (
            <a href={`/api/vault-contact-card/${current.id}`} className="btn-ghost mt-1 px-3 py-1 text-xs">
              Add to Contacts
            </a>
          )}
        </div>

        <div className="mt-6 grid grid-cols-2 gap-2">
          {OUTCOMES.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                setOutcome(o.value);
                setError(null);
              }}
              className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition active:scale-[0.97] ${
                outcome === o.value
                  ? o.activeClass
                  : "border-zinc-300 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-600"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>

        <textarea
          className="input mt-4"
          rows={3}
          placeholder="Notes from the call…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

        <button type="button" disabled={submitting} onClick={confirm} className="btn-primary mt-4 w-full">
          {submitting ? "Saving…" : "Confirm"}
        </button>
      </div>
    </div>
  );
}
