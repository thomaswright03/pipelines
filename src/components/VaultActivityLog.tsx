"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addLeadActivityAction } from "@/lib/actions/vault-pipeline";

type Activity = { id: string; type: string; notes: string; date: string };

export default function VaultActivityLog({ leadId, activities }: { leadId: string; activities: Activity[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [type, setType] = useState("note");
  const [notes, setNotes] = useState("");

  function submit() {
    if (!notes.trim()) return;
    startTransition(async () => {
      await addLeadActivityAction(leadId, type, notes);
      setNotes("");
      router.refresh();
    });
  }

  return (
    <div className="card p-4">
      <h2 className="mb-2 text-sm font-semibold text-zinc-500">Activity</h2>

      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <select value={type} onChange={(e) => setType(e.target.value)} className="input w-auto">
            <option value="note">Note</option>
            <option value="call">Call</option>
            <option value="email">Email</option>
            <option value="meeting">Meeting</option>
          </select>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What happened…"
            className="input flex-1"
          />
          <button disabled={isPending || !notes.trim()} onClick={submit} className="btn-primary">
            Add
          </button>
        </div>

        {activities.length === 0 ? (
          <p className="text-sm text-zinc-500">No activity logged yet.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {activities.map((a) => (
              <li key={a.id} className="flex justify-between gap-3 border-t border-zinc-100 pt-2 dark:border-zinc-800">
                <span>
                  <span className="mr-2 rounded-full bg-indigo-50 px-1.5 py-0.5 text-xs font-medium uppercase text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">
                    {a.type}
                  </span>
                  {a.notes}
                </span>
                <span className="shrink-0 text-xs text-zinc-400">{new Date(a.date).toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
