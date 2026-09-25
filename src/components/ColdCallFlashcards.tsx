"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { confirmColdCallAction } from "@/lib/actions/outreach";
import { COLD_CALL_OUTCOMES, COLD_CALL_OUTCOME_LABEL, type ColdCallOutcome } from "@/lib/lead-status";
import { PIPELINE_BASE_PATH, type PipelineId } from "@/lib/outreach/pipeline-id";
import { getTimezoneForState, formatLocalTime } from "@/lib/us-timezones";

const CLOCK_TICK_MS = 30_000;

/** Live clock, so "what time is it there" stays right on a card left open a while. */
function useNow(intervalMs: number): Date | null {
  // null until mounted: the server's clock and zone aren't the caller's.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [intervalMs]);
  return now;
}

export type ColdCallLead = {
  id: string;
  name: string;
  subtitle: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
};

const OUTCOME_STYLE: Record<ColdCallOutcome, string> = {
  no_answer: "border-zinc-600 bg-zinc-600 text-white",
  invalid_number: "border-zinc-600 bg-zinc-600 text-white",
  not_interested: "border-red-600 bg-red-600 text-white",
  interested: "border-emerald-600 bg-emerald-600 text-white",
};

type Logged = { lead: ColdCallLead; outcome: ColdCallOutcome | "skipped" };

// One card at a time. The deck is a snapshot taken when the page loaded, so
// confirming a call (which may move the lead off the list) never shifts
// which card comes next; the summary at the end shows what was recorded.
export default function ColdCallFlashcards({ pipeline, leads: initialLeads }: { pipeline: PipelineId; leads: ColdCallLead[] }) {
  const [leads] = useState(initialLeads);
  const [index, setIndex] = useState(0);
  const [outcome, setOutcome] = useState<ColdCallOutcome | null>(null);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<Logged[]>([]);
  const now = useNow(CLOCK_TICK_MS);
  const basePath = PIPELINE_BASE_PATH[pipeline];

  const current = leads[index];

  function next(entry: Logged) {
    setLog((l) => [...l, entry]);
    setIndex((i) => i + 1);
    setOutcome(null);
    setNotes("");
    setError(null);
  }

  async function confirm() {
    if (!current) return;
    if (!outcome) {
      setError("Pick how the call went first.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await confirmColdCallAction(pipeline, current.id, outcome, notes);
      if (result.ok) next({ lead: current, outcome });
      else setError(result.error);
    } catch {
      setError("Couldn't reach the server — the call wasn't saved. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (leads.length === 0) {
    return (
      <div className="card p-8 text-center">
        <p className="text-sm muted">Nobody is on the call list right now.</p>
        <p className="mt-1 text-sm muted">Leads land here a week after an unanswered email, or when no email could be found.</p>
      </div>
    );
  }

  if (!current) return <Summary log={log} basePath={basePath} />;

  const timezone = getTimezoneForState(current.state);
  const localTimeLabel = timezone && now ? formatLocalTime(now, timezone) : null;

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex items-center gap-3">
        <p className="text-xs font-medium muted">
          Card {index + 1} of {leads.length}
        </p>
        <div
          className="h-1.5 w-32 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={leads.length}
          aria-valuenow={index}
          aria-label="Calls worked through"
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-300"
            style={{ width: `${(index / leads.length) * 100}%` }}
          />
        </div>
      </div>

      <div className="card w-full max-w-md p-6 shadow-lg shadow-indigo-500/5 sm:p-8">
        <h2 className="break-words text-center text-2xl font-bold">
          <Link href={`${basePath}/${current.id}`} className="hover:text-indigo-700 dark:hover:text-indigo-300">
            {current.name}
          </Link>
        </h2>
        {current.subtitle && <p className="mt-1 text-center text-sm muted">{current.subtitle}</p>}

        <div className="mt-4 flex flex-col items-center gap-1.5">
          {current.phone ? (
            <a
              href={`tel:${current.phone}`}
              className="inline-flex min-h-11 items-center gap-2 text-lg font-medium text-indigo-700 hover:text-indigo-600 dark:text-indigo-300"
            >
              {current.phone}
            </a>
          ) : (
            <span className="text-sm muted">No phone on file</span>
          )}
          {(current.city || current.state) && <span className="text-sm muted">{[current.city, current.state].filter(Boolean).join(", ")}</span>}
          {localTimeLabel && <span className="text-xs muted">{localTimeLabel} there</span>}
          {current.phone && (
            <a href={`/api/contact-card/${pipeline}/${current.id}`} className="btn-ghost mt-1 text-xs">
              Add to Contacts
            </a>
          )}
        </div>

        <fieldset className="mt-6">
          <legend className="sr-only">How did the call go?</legend>
          <div className="grid grid-cols-2 gap-2">
            {COLD_CALL_OUTCOMES.map((o) => (
              <button
                key={o}
                type="button"
                aria-pressed={outcome === o}
                onClick={() => {
                  setOutcome(o);
                  setError(null);
                }}
                className={`min-h-11 rounded-lg border px-3 py-2.5 text-sm font-medium transition active:scale-[0.97] ${
                  outcome === o ? OUTCOME_STYLE[o] : "border-zinc-300 hover:border-zinc-500 dark:border-zinc-700 dark:hover:border-zinc-500"
                }`}
              >
                {COLD_CALL_OUTCOME_LABEL[o]}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="sr-only" htmlFor="call-notes">
          Notes from the call
        </label>
        <textarea
          id="call-notes"
          className="input mt-4"
          rows={3}
          maxLength={2000}
          placeholder="Notes from the call…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        <div aria-live="polite">{error && <p className="notice-error mt-2">{error}</p>}</div>

        <div className="mt-4 flex gap-2">
          <button type="button" disabled={submitting} onClick={() => next({ lead: current, outcome: "skipped" })} className="btn-secondary">
            Skip
          </button>
          <button type="button" disabled={submitting} onClick={confirm} className="btn-primary flex-1">
            {submitting ? "Saving…" : "Save and next"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Summary({ log, basePath }: { log: Logged[]; basePath: string }) {
  const counts = new Map<string, number>();
  for (const entry of log) counts.set(entry.outcome, (counts.get(entry.outcome) ?? 0) + 1);
  const interested = log.filter((e) => e.outcome === "interested");
  const rows: { key: string; label: string }[] = [
    ...COLD_CALL_OUTCOMES.map((o) => ({ key: o, label: COLD_CALL_OUTCOME_LABEL[o] })),
    { key: "skipped", label: "Skipped" },
  ];

  return (
    <div className="card mx-auto flex w-full max-w-md flex-col gap-4 p-6 sm:p-8">
      <div className="text-center">
        <h2 className="text-xl font-bold">Deck finished</h2>
        <p className="mt-1 text-sm muted">You worked through {log.length} card{log.length === 1 ? "" : "s"}.</p>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        {rows.map((r) => (
          <div key={r.key} className="flex justify-between rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/60">
            <dt>{r.label}</dt>
            <dd className="font-semibold">{counts.get(r.key) ?? 0}</dd>
          </div>
        ))}
      </dl>
      {interested.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">Interested — follow up</h3>
          <ul className="mt-1 list-disc pl-5 text-sm">
            {interested.map((e) => (
              <li key={e.lead.id}>
                <Link href={`${basePath}/${e.lead.id}`} className="text-indigo-700 hover:underline dark:text-indigo-300">
                  {e.lead.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-center text-sm muted">No-answers stay on the list for another try. Reload the page to start a fresh deck.</p>
    </div>
  );
}
