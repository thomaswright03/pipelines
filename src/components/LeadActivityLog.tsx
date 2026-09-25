"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addLeadActivityAction } from "@/lib/actions/outreach";
import type { PipelineId } from "@/lib/outreach/pipeline-id";
import ActionMessage, { type Feedback } from "@/components/ActionMessage";

type Activity = { id: string; type: string; notes: string; date: string };

const TYPE_LABEL: Record<string, string> = { note: "Note", call: "Call", email: "Email", meeting: "Meeting" };

/**
 * A lead's history, newest first: replies received and cold calls (added
 * automatically) and anything the operator logs here. Kept apart from the
 * lead's Notes, so it never counts against the notes limit. A real form, so
 * Enter in the text box adds the entry; the text stays in the box if saving
 * fails.
 */
export default function LeadActivityLog({
  pipeline,
  leadId,
  activities,
}: {
  pipeline: PipelineId;
  leadId: string;
  activities: Activity[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [type, setType] = useState("note");
  const [notes, setNotes] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!notes.trim()) {
      setFeedback({ ok: false, text: "Write what happened first." });
      return;
    }
    setFeedback(null);
    startTransition(async () => {
      try {
        const result = await addLeadActivityAction(pipeline, leadId, type, notes);
        if (result.ok) {
          setNotes("");
          setFeedback({ ok: true, text: result.message });
        } else {
          setFeedback({ ok: false, text: result.error });
        }
      } catch {
        setFeedback({ ok: false, text: "Couldn't reach the server — the entry wasn't saved. Try again." });
      }
      router.refresh();
    });
  }

  return (
    <section aria-labelledby="activity-heading" className="card p-4">
      <h2 id="activity-heading" className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
        History
      </h2>
      <p className="mb-2 text-sm muted">Replies and calls are added here automatically. Log anything else below.</p>

      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="activity-type">
          Entry type
        </label>
        <select id="activity-type" value={type} onChange={(e) => setType(e.target.value)} className="input sm:w-auto">
          {Object.entries(TYPE_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="activity-notes">
          What happened
        </label>
        <input
          id="activity-notes"
          value={notes}
          maxLength={2000}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What happened…"
          className="input flex-1"
        />
        <button type="submit" disabled={isPending} className="btn-primary">
          {isPending ? "Adding…" : "Add"}
        </button>
      </form>
      <div className="mt-2">
        <ActionMessage feedback={feedback} />
      </div>

      {activities.length === 0 ? (
        <p className="mt-2 text-sm muted">Nothing here yet.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2 text-sm">
          {activities.map((a) => (
            <li key={a.id} className="flex justify-between gap-3 border-t border-zinc-100 pt-2 dark:border-zinc-800">
              <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                <span className="mr-2 rounded-full bg-indigo-50 px-1.5 py-0.5 text-xs font-medium uppercase text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">
                  {TYPE_LABEL[a.type] ?? a.type}
                </span>
                <span className="whitespace-pre-wrap">{a.notes}</span>
              </span>
              <span className="shrink-0 text-xs muted">{a.date}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
