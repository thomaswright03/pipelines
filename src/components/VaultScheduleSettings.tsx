"use client";

import { useActionState } from "react";
import { updatePipelineScheduleAction, type PipelineScheduleData } from "@/lib/actions/pipeline-schedule";

const boundAction = updatePipelineScheduleAction.bind(null, "vault-pipeline", "/vault-pipeline");

export default function VaultScheduleSettings({ schedule }: { schedule: PipelineScheduleData }) {
  const [state, formAction, isPending] = useActionState(boundAction, {});

  return (
    <div className="card flex flex-col gap-3 p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Daily automation
      </h2>
      <p className="text-xs text-zinc-500">
        Live right now: runs automatically every day at <strong>8:33 AM Arizona time</strong>, extracts up
        to the lead count below in one new city, finds emails, and sends outreach to whichever of those end
        up with one. &quot;Enabled&quot; and &quot;Leads per run&quot; below take effect on the very next
        run — no redeploy needed. Changing the <em>time</em> itself needs a redeploy (Vercel&apos;s free
        plan can&apos;t reschedule cron jobs live), so save your desired time here and ask me to apply it.
      </p>

      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={schedule.enabled}
            className="h-4 w-4 accent-indigo-600"
          />
          Enabled
        </label>
        <Field name="hour" label="Hour (0-23)" defaultValue={schedule.hour} />
        <Field name="minute" label="Minute (0-59)" defaultValue={schedule.minute} />
        <Field name="leadCount" label="Leads per run" defaultValue={schedule.leadCount} />
        <button type="submit" disabled={isPending} className="btn-primary">
          {isPending ? "Saving…" : "Save desired schedule"}
        </button>
        {state.error && <p className="w-full text-sm text-red-600 dark:text-red-400">{state.error}</p>}
        {state.saved && (
          <p className="w-full text-sm text-zinc-600 dark:text-zinc-400">
            Saved. Enabled/leads-per-run apply immediately. Ask me to redeploy if you changed the time.
          </p>
        )}
      </form>
    </div>
  );
}

function Field({ name, label, defaultValue }: { name: string; label: string; defaultValue: number }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-zinc-500">
      {label}
      <input type="number" name={name} defaultValue={defaultValue} required className="input w-28" />
    </label>
  );
}
