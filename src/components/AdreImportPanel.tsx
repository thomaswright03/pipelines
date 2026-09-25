"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { loadAdreRosterAction, processAdreChunkAction } from "@/lib/actions/dataleadsell";
import type { AdreStatus } from "@/lib/adre-import";
import ActionMessage, { type Feedback } from "@/components/ActionMessage";

export type AdreStatusView = Omit<AdreStatus, "loadedAt"> & { loadedAtLabel: string | null };

/**
 * The Maricopa ADRE import. The roster is downloaded once (and refreshed
 * monthly once fully worked through); each click then works through the
 * licensees in order, a few per server call, picking up exactly where the
 * last run stopped.
 */
export default function AdreImportPanel({ initial }: { initial: AdreStatusView }) {
  const router = useRouter();
  const stopRequested = useRef(false);
  const [status, setStatus] = useState(initial);
  const [running, setRunning] = useState<null | "loading" | "checking">(null);
  const [stopping, setStopping] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [session, setSession] = useState({ checked: 0, created: 0 });

  async function run() {
    stopRequested.current = false;
    setStopping(false);
    setFeedback(null);
    const totals = { checked: 0, created: 0 };
    setSession(totals);
    let current = status;

    if (current.needsLoad) {
      setRunning("loading");
      try {
        const loaded = await loadAdreRosterAction();
        if (!loaded.ok) {
          setFeedback({ ok: false, text: loaded.error });
          setRunning(null);
          return;
        }
        current = { ...loaded.status, loadedAtLabel: "just now" };
        setStatus(current);
      } catch {
        setFeedback({ ok: false, text: "Lost contact with the server while downloading the roster. Nothing changed — try again." });
        setRunning(null);
        return;
      }
    }

    setRunning("checking");
    let error: string | null = null;
    while (current.remaining > 0 && !stopRequested.current) {
      let chunk;
      try {
        chunk = await processAdreChunkAction();
      } catch {
        error = "Lost contact with the server. Progress so far is saved — click again to continue.";
        break;
      }
      if (!chunk.ok) {
        error = chunk.error;
        break;
      }
      totals.checked += chunk.result.checked;
      totals.created += chunk.result.created;
      setSession({ ...totals });
      current = { ...chunk.result.status, loadedAtLabel: current.loadedAtLabel };
      setStatus(current);
      if (chunk.result.checked === 0) break;
    }
    setRunning(null);

    const summary = `Checked ${totals.checked} licensee${totals.checked === 1 ? "" : "s"} and added ${totals.created} new agent${totals.created === 1 ? "" : "s"} this run; ${current.remaining.toLocaleString("en-US")} left.`;
    setFeedback(error ? { ok: false, text: `${error} ${summary}` } : { ok: true, text: current.remaining === 0 ? `Done — the whole roster has been checked. ${summary}` : `Stopped. ${summary}` });
    router.refresh();
  }

  const pct = status.total > 0 ? Math.round((status.checked / status.total) * 100) : 0;
  const label = status.needsLoad
    ? status.loaded
      ? "Refresh ADRE roster and continue"
      : "Import Maricopa agents (ADRE)"
    : status.remaining > 0
      ? `Continue ADRE import (${status.remaining.toLocaleString("en-US")} left)`
      : "ADRE roster fully checked";

  return (
    <section aria-labelledby="adre-heading" className="card flex flex-col gap-3 p-4">
      <h2 id="adre-heading" className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
        Maricopa County licensees (Arizona ADRE roster)
      </h2>
      <p className="text-sm muted">
        {status.loaded
          ? `Roster loaded ${status.loadedAtLabel ?? ""}: ${status.total.toLocaleString("en-US")} active licensees, ${status.checked.toLocaleString("en-US")} checked, ${status.created.toLocaleString("en-US")} added as agents.`
          : "Not loaded yet. The first click downloads ADRE's public license roster (it can take up to a minute), then starts checking licensees for an email of their own."}
      </p>
      {status.total > 0 && (
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label="ADRE import progress"
        >
          <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2" aria-live="polite">
        {running ? (
          <>
            <p className="text-sm">
              {running === "loading"
                ? "Downloading ADRE's roster…"
                : `Checking licensees… ${session.checked} checked, ${session.created} added this run.`}
            </p>
            {running === "checking" && (
              <button
                type="button"
                disabled={stopping}
                onClick={() => {
                  stopRequested.current = true;
                  setStopping(true);
                }}
                className="btn-danger"
              >
                {stopping ? "Stopping…" : "Stop"}
              </button>
            )}
          </>
        ) : (
          <button type="button" onClick={run} disabled={!status.needsLoad && status.remaining === 0} className="btn-secondary">
            {label}
          </button>
        )}
      </div>
      <ActionMessage feedback={feedback} />
    </section>
  );
}
