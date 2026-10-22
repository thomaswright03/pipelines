"use client";

import { useActionState, useState } from "react";
import type { UpdateScheduleState } from "@/lib/actions/pipeline-schedule";
import {
  EMAILS_PER_DAY_LABEL,
  EMAILS_PER_DAY_MAX,
  EMAILS_PER_DAY_MIN,
  rangeMessage,
  type PipelineScheduleData,
} from "@/lib/pipeline-schedule-rules";
import type { PipelineId } from "@/lib/outreach/pipeline-id";
import { GARBAGE_AI_SENDING_HELD } from "@/lib/garbage-ai-config";
import { ROOM_DESIGNER_SENDING_HELD } from "@/lib/room-designer-config";
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

/** How each pipeline's daily run describes what it searches, checks and emails. */
const WORDING: Record<
  PipelineId,
  {
    perDayLabel: string;
    /** What the run checks for an address. */
    checked: { one: string; many: string };
    /** What the run emails. */
    emailed: { one: string; many: string };
    /** What the runs do, after "On: runs <times>." */
    describe: (perDay: number) => string;
    /** Why a day can fall short of the number. */
    yieldNote: string;
  }
> = {
  "cold-outreach": {
    perDayLabel: EMAILS_PER_DAY_LABEL,
    checked: { one: "business", many: "businesses" },
    emailed: { one: "lead", many: "leads" },
    describe: (n) =>
      `Each run sends first pitches until ${n} have gone out today, searching a new city in the business list for business email addresses when the leads already found don't cover it. Once ${n} are sent, the rest of the day's runs do nothing.`,
    yieldNote:
      "Only about 1 in 5 businesses has a findable email address and each run has about a minute, so one run sends roughly 10 at most. A day with a high number can fall short; the next day starts fresh.",
  },
  dataleadsell: {
    perDayLabel: EMAILS_PER_DAY_LABEL,
    checked: { one: "agent", many: "agents" },
    emailed: { one: "agent", many: "agents" },
    describe: (n) =>
      `Each run sends first pitches until ${n} have gone out today, searching the next city in the business list for real estate agents when the agents already found don't cover it. Once ${n} are sent, the rest of the day's runs do nothing.`,
    yieldNote:
      "Not every agent has a findable email address and each run has about a minute, so one run sends roughly 10 at most. A day with a high number can fall short; the next day starts fresh.",
  },
  "garbage-ai": {
    perDayLabel: EMAILS_PER_DAY_LABEL,
    checked: { one: "hauler", many: "haulers" },
    emailed: { one: "hauler", many: "haulers" },
    describe: (n) =>
      GARBAGE_AI_SENDING_HELD
        ? `Each run searches a new city in the business list for waste haulers and saves the haulers it finds an email address for, until ${n} are waiting. Sending is on hold, so it emails nobody.`
        : `Each run sends first pitches until ${n} have gone out today, searching a new city in the business list for waste haulers when the haulers already found don't cover it. Once ${n} are sent, the rest of the day's runs do nothing.`,
    yieldNote:
      "Not every hauler has a findable email address and each run has about a minute, so one run sends roughly 10 at most. A day with a high number can fall short; the next day starts fresh.",
  },
  "room-designer": {
    perDayLabel: EMAILS_PER_DAY_LABEL,
    checked: { one: "remodeler", many: "remodelers" },
    emailed: { one: "remodeler", many: "remodelers" },
    describe: (n) =>
      ROOM_DESIGNER_SENDING_HELD
        ? `Each weekday's run searches new cities in the business list for bathroom remodelers and saves the remodelers it finds an email address for, until ${n} are waiting. Sending is on hold, so it emails nobody.`
        : `Each weekday's run sends ${n} first pitches, searching new cities in the business list for bathroom remodelers when the remodelers already found don't cover it.`,
    yieldNote:
      "Not every remodeler has a findable email address, and the run searches at most 6 cities in its 5 minutes, so a day with a high number can fall short; the next weekday starts fresh.",
  },
};

/**
 * A pipeline's daily run: its real state (on, off, or held by the global
 * pause), the two settings that apply live, and what the last few runs
 * actually did. `action` saves the settings for this pipeline.
 */
export default function DailyRunSettings({
  pipeline,
  action,
  schedule,
  runTimeLabel,
  paused,
  runs,
  staleWarning,
}: {
  pipeline: PipelineId;
  action: (prev: UpdateScheduleState, formData: FormData) => Promise<UpdateScheduleState>;
  schedule: PipelineScheduleData;
  runTimeLabel: string;
  paused: boolean;
  runs: RunView[];
  staleWarning: string | null;
}) {
  const wording = WORDING[pipeline];
  const [enabled, setEnabled] = useState(schedule.enabled);
  const [emailsPerDay, setEmailsPerDay] = useState(String(schedule.emailsPerDay));
  const [clientError, setClientError] = useState<string | null>(null);
  const [state, formAction, isPending] = useActionState((prev: UpdateScheduleState, formData: FormData) => action(prev, formData), {});

  const live = schedule.enabled && !paused;
  // The latest run, whatever its outcome — a failed run must not read like a quiet day.
  const lastRun = runs[0] ?? null;
  const lastStatus = lastRun ? (RUN_STATUS[lastRun.status] ?? { label: lastRun.status, className: RUN_STATUS.skipped!.className }) : null;
  const stateLine = paused
    ? "On hold: outbound email is paused, so the daily run skips itself (see Settings)."
    : schedule.enabled
      ? `On: runs ${runTimeLabel}. ${wording.describe(schedule.emailsPerDay)}`
      : "Off: the daily run is skipped until you turn it back on.";

  function validate(e: React.FormEvent<HTMLFormElement>) {
    const n = Number(emailsPerDay);
    if (!Number.isInteger(n) || n < EMAILS_PER_DAY_MIN || n > EMAILS_PER_DAY_MAX) {
      e.preventDefault();
      setClientError(rangeMessage(wording.perDayLabel));
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
          {wording.perDayLabel} ({EMAILS_PER_DAY_MIN}–{EMAILS_PER_DAY_MAX})
          <input
            type="number"
            name="emailsPerDay"
            inputMode="numeric"
            min={EMAILS_PER_DAY_MIN}
            max={EMAILS_PER_DAY_MAX}
            step={1}
            value={emailsPerDay}
            onChange={(e) => setEmailsPerDay(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "schedule-error schedule-yield" : "schedule-yield"}
            className="input w-32"
          />
        </label>
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
        <p className="muted">{wording.yieldNote}</p>
        {lastRun && lastStatus ? (
          <p>
            <span className={`mr-1 rounded-full px-2 py-0.5 text-xs font-medium ${lastStatus.className}`}>{lastStatus.label}</span>
            <span className="font-medium">Last run ({lastRun.startedAt}):</span>{" "}
            {lastRun.numbers ? (
              <>
                checked {plural(lastRun.numbers.businessesChecked, wording.checked.one, wording.checked.many)}, found{" "}
                {plural(lastRun.numbers.leadsFound, "address", "addresses")}, emailed{" "}
                <strong>{plural(lastRun.numbers.emailsSent, wording.emailed.one, wording.emailed.many)}</strong>.
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
      <p className="text-sm muted">
        When it&apos;s on, it runs {runTimeLabel}. Those times are fixed in the app&apos;s schedule; ask your developer if they should
        change.
      </p>

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
