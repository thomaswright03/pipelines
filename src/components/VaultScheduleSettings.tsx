"use client";

import { useActionState, useState } from "react";
import { updateGarbageAiScheduleAction, updateVaultScheduleAction, type UpdateScheduleState } from "@/lib/actions/pipeline-schedule";
import {
  BUSINESSES_PER_RUN_LABEL,
  BUSINESSES_PER_RUN_MAX,
  BUSINESSES_PER_RUN_MIN,
  RANGE_MESSAGE,
  type PipelineScheduleData,
} from "@/lib/pipeline-schedule-rules";
import ActionMessage from "@/components/ActionMessage";
import { plural } from "@/lib/format";

export type RunView = {
  id: string;
  status: string;
  startedAt: string; // formatted in the app's time zone
  summary: string | null;
  errors: string[];
  numbers: { businessesChecked: number; leadsFound: number; emailsSent: number } | null;
};

const RUN_STATUS: Record<string, { label: string; className: string }> = {
  succeeded: { label: "Succeeded", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" },
  partial: { label: "Partly failed", className: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
  failed: { label: "Failed", className: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" },
  skipped: { label: "Skipped", className: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
  running: { label: "Running", className: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300" },
  interrupted: {
    label: "Interrupted",
    className: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  },
};

/**
 * The daily run of Cold Outreach (or, with `haulers`, Garbage AI's hauler
 * search): its real state (on, off, or held by the
 * global pause), the two settings that apply live, and what the last few
 * runs actually did.
 */
export default function VaultScheduleSettings({
  schedule,
  runTimeLabel,
  paused,
  runs,
  staleWarning,
  sendHold = null,
  haulers = false,
}: {
  schedule: PipelineScheduleData;
  runTimeLabel: string;
  paused: boolean;
  runs: RunView[];
  staleWarning: string | null;
  /** Garbage AI: why its run only searches (sends held), or null once it also sends. */
  sendHold?: string | null;
  haulers?: boolean;
}) {
  const [enabled, setEnabled] = useState(schedule.enabled);
  const [businessesPerRun, setLeadCount] = useState(String(schedule.businessesPerRun));
  const [clientError, setClientError] = useState<string | null>(null);
  const [state, formAction, isPending] = useActionState(
    (prev: UpdateScheduleState, formData: FormData) =>
      haulers ? updateGarbageAiScheduleAction(prev, formData) : updateVaultScheduleAction(prev, formData),
    {},
  );

  // Garbage AI's run only searches while its sends are held, so the global pause doesn't stop it.
  const searchOnly = haulers && sendHold !== null;
  const heldByPause = paused && !searchOnly;
  const live = schedule.enabled && !heldByPause;
  // The latest run, whatever its outcome — a failed run must not read like a quiet day.
  const lastRun = runs[0] ?? null;
  const lastStatus = lastRun ? (RUN_STATUS[lastRun.status] ?? { label: lastRun.status, className: RUN_STATUS.skipped!.className }) : null;
  const stateLine = searchOnly
    ? schedule.enabled
      ? `On: runs every day at ${runTimeLabel}. It searches one new city on Yelp for garbage collection, checks up to ${schedule.businessesPerRun} of those haulers for an email address, and saves the ones it finds. Sending is on hold, so it emails nobody.`
      : "Off: the daily search is skipped until you turn it back on."
    : heldByPause
      ? "On hold: outbound email is paused, so the daily run skips itself (see Settings)."
      : schedule.enabled
        ? `On: runs every day at ${runTimeLabel}. It searches one new city on Yelp, checks up to ${schedule.businessesPerRun} of those businesses for an email address, and sends the first pitch to each one it finds — plus any found earlier that haven't been emailed yet.`
        : "Off: the daily run is skipped until you turn it back on.";

  function validate(e: React.FormEvent<HTMLFormElement>) {
    const n = Number(businessesPerRun);
    if (!Number.isInteger(n) || n < BUSINESSES_PER_RUN_MIN || n > BUSINESSES_PER_RUN_MAX) {
      e.preventDefault();
      setClientError(RANGE_MESSAGE);
      return;
    }
    setClientError(null);
  }

  const error = clientError ?? state.error;

  return (
    <section aria-labelledby="daily-heading" className="card flex flex-col gap-3 p-4">
      <h2 id="daily-heading" className="flex items-center gap-2 text-sm font-semibold">
        <span className={`h-2 w-2 rounded-full ${live ? "bg-emerald-500" : heldByPause ? "bg-red-500" : "bg-zinc-400"}`} aria-hidden />
        Daily automation
      </h2>
      <p className="text-sm muted">{stateLine}</p>
      {staleWarning && <p className="notice-warning">{staleWarning}</p>}

      <form action={formAction} onSubmit={validate} noValidate className="flex flex-wrap items-end gap-3">
        <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
          <input
            type="checkbox"
            name="enabled"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-5 w-5 accent-indigo-600"
          />
          Run daily
        </label>
        <label className="field-label">
          {BUSINESSES_PER_RUN_LABEL} ({BUSINESSES_PER_RUN_MIN}–{BUSINESSES_PER_RUN_MAX})
          <input
            type="number"
            name="businessesPerRun"
            inputMode="numeric"
            min={BUSINESSES_PER_RUN_MIN}
            max={BUSINESSES_PER_RUN_MAX}
            step={1}
            value={businessesPerRun}
            onChange={(e) => setLeadCount(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "schedule-error schedule-yield" : "schedule-yield"}
            className="input w-32"
          />
        </label>
        <div className="field-label">
          Time
          <p className="flex min-h-11 items-center text-sm font-normal sm:min-h-9">{runTimeLabel}</p>
        </div>
        <button type="submit" disabled={isPending} className="btn-primary">
          {isPending ? "Saving…" : "Save"}
        </button>
      </form>
      <div id="schedule-error">
        <ActionMessage
          feedback={
            error ? { ok: false, text: error } : state.saved ? { ok: true, text: "Saved — the next daily run uses these settings." } : null
          }
        />
      </div>
      <div id="schedule-yield" className="flex flex-col gap-1 text-sm">
        <p className="muted">
          Not every business has a findable email address — usually only about 1 in 5 do — and each run stops looking after about 25
          seconds, so expect far fewer emails than businesses checked.
        </p>
        {lastRun && lastStatus ? (
          <p>
            <span className={`mr-1 rounded-full px-2 py-0.5 text-xs font-medium ${lastStatus.className}`}>{lastStatus.label}</span>
            <span className="font-medium">Last run ({lastRun.startedAt}):</span>{" "}
            {lastRun.numbers ? (
              <>
                checked {plural(lastRun.numbers.businessesChecked, "business", "businesses")}, found{" "}
                {plural(lastRun.numbers.leadsFound, "address", "addresses")}, emailed{" "}
                <strong>{plural(lastRun.numbers.emailsSent, "lead", "leads")}</strong>.
              </>
            ) : (
              (lastRun.summary ?? "No details were recorded.")
            )}
            {(lastRun.status === "failed" || lastRun.status === "partial" || lastRun.status === "interrupted") && lastRun.errors[0] && (
              <span className="block text-red-800 dark:text-red-300">First problem: {lastRun.errors[0]}</span>
            )}
          </p>
        ) : (
          <p className="muted">No daily run has happened yet, so there are no results to show.</p>
        )}
      </div>
      <p className="text-sm muted">The daily run time is fixed; ask your developer to change it.</p>

      <div className="border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Recent runs</h3>
        {runs.length === 0 ? (
          <p className="mt-1 text-sm muted">No runs recorded yet.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2 text-sm">
            {runs.map((run) => {
              const s = RUN_STATUS[run.status] ?? RUN_STATUS.running!;
              return (
                <li key={run.id} className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.className}`}>{s.label}</span>
                    <span className="muted">{run.startedAt}</span>
                  </div>
                  {run.summary && <p className="break-words">{run.summary}</p>}
                  <RunErrors status={run.status} errors={run.errors} />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

/**
 * A failed or partial run says why right in its row; the rest of its
 * messages (and a clean run's skipped leads) sit behind Details.
 */
function RunErrors({ status, errors }: { status: string; errors: string[] }) {
  const problem = status !== "succeeded" && status !== "running" && errors.length > 0;
  const rest = problem ? errors.slice(1) : errors;
  return (
    <>
      {problem && <p className="break-words text-red-800 dark:text-red-300">{errors[0]}</p>}
      {rest.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-medium">
            {problem ? "More details" : "Details"} ({rest.length})
          </summary>
          <ul className="mt-1 list-disc pl-5 text-sm muted">
            {rest.map((e, i) => (
              <li key={i} className="break-words">
                {e}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
