"use client";

import { useActionState, useState } from "react";
import { updateVaultScheduleAction, type UpdateScheduleState } from "@/lib/actions/pipeline-schedule";
import { LEAD_COUNT_MAX, LEAD_COUNT_MIN, type PipelineScheduleData } from "@/lib/pipeline-schedule-rules";
import ActionMessage from "@/components/ActionMessage";

export type RunView = {
  id: string;
  status: string;
  startedAt: string; // formatted in the app's time zone
  summary: string | null;
  errors: string[];
};

const RUN_STATUS: Record<string, { label: string; className: string }> = {
  succeeded: { label: "Succeeded", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" },
  partial: { label: "Partly failed", className: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
  failed: { label: "Failed", className: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" },
  skipped: { label: "Skipped", className: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
  running: { label: "Running", className: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300" },
};

/**
 * The daily Cold Outreach run: its real state (on, off, or held by the
 * global pause), the two settings that apply live, and what the last few
 * runs actually did.
 */
export default function VaultScheduleSettings({
  schedule,
  runTimeLabel,
  paused,
  runs,
  staleWarning,
}: {
  schedule: PipelineScheduleData;
  runTimeLabel: string;
  paused: boolean;
  runs: RunView[];
  staleWarning: string | null;
}) {
  const [enabled, setEnabled] = useState(schedule.enabled);
  const [leadCount, setLeadCount] = useState(String(schedule.leadCount));
  const [clientError, setClientError] = useState<string | null>(null);
  const [state, formAction, isPending] = useActionState(
    (prev: UpdateScheduleState, formData: FormData) => updateVaultScheduleAction(prev, formData),
    {},
  );

  const live = schedule.enabled && !paused;
  const stateLine = paused
    ? "On hold: outbound email is paused, so the daily run skips itself (see Settings)."
    : schedule.enabled
      ? `On: runs every day at ${runTimeLabel}. It searches one new city for up to ${schedule.leadCount} businesses, finds their emails, and sends each new lead the first pitch.`
      : "Off: the daily run is skipped until you turn it back on.";

  function validate(e: React.FormEvent<HTMLFormElement>) {
    const n = Number(leadCount);
    if (!Number.isInteger(n) || n < LEAD_COUNT_MIN || n > LEAD_COUNT_MAX) {
      e.preventDefault();
      setClientError(`Leads per run must be a whole number between ${LEAD_COUNT_MIN} and ${LEAD_COUNT_MAX}`);
      return;
    }
    setClientError(null);
  }

  const error = clientError ?? state.error;

  return (
    <section aria-labelledby="daily-heading" className="card flex flex-col gap-3 p-4">
      <h2 id="daily-heading" className="flex items-center gap-2 text-sm font-semibold">
        <span className={`h-2 w-2 rounded-full ${live ? "bg-emerald-500" : paused ? "bg-red-500" : "bg-zinc-400"}`} aria-hidden />
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
          Leads per run ({LEAD_COUNT_MIN}–{LEAD_COUNT_MAX})
          <input
            type="number"
            name="leadCount"
            inputMode="numeric"
            min={LEAD_COUNT_MIN}
            max={LEAD_COUNT_MAX}
            step={1}
            value={leadCount}
            onChange={(e) => setLeadCount(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "schedule-error" : undefined}
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
      <p className="text-xs muted">The run time is fixed by the deployment (vercel.json); changing it needs a code change and redeploy.</p>

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
                  {run.errors.length > 0 && (
                    <details>
                      <summary className="cursor-pointer text-xs font-medium text-red-800 dark:text-red-300">
                        {run.errors.length} problem{run.errors.length === 1 ? "" : "s"}
                      </summary>
                      <ul className="mt-1 list-disc pl-5 text-xs muted">
                        {run.errors.map((e, i) => (
                          <li key={i} className="break-words">
                            {e}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
