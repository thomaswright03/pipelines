"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  findAgentEmailAction,
  sendOutreachEmailAction,
  updateAgentStatusAction,
  markAgentRepliedAction,
  markAgentBouncedAction,
  markAgentOptedOutAction,
} from "@/lib/actions/dataleadsell";

const STATUSES = [
  "new",
  "contacted",
  "responded",
  "subscribed",
  "not_interested",
  "cold_call_list",
  "contactless_list",
  "lost",
];

export default function AgentLeadActions({
  leadId,
  status,
  hasEmail,
}: {
  leadId: string;
  status: string;
  hasEmail: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function run(label: string, fn: () => Promise<({ error?: string } & Record<string, unknown>) | void>) {
    setMessage(null);
    startTransition(async () => {
      const result = await fn();
      const error = result && typeof result === "object" && "error" in result ? result.error : undefined;
      setMessage(error ? `${label} failed: ${error}` : `${label}: done.`);
      router.refresh();
    });
  }

  return (
    <div className="card flex flex-col gap-3 p-4">
      <div>
        <label className="text-xs text-zinc-500">Status</label>
        <select
          defaultValue={status}
          disabled={isPending}
          onChange={(e) =>
            startTransition(async () => {
              await updateAgentStatusAction(leadId, e.target.value);
              router.refresh();
            })
          }
          className="input mt-1"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        {!hasEmail && (
          <button disabled={isPending} onClick={() => run("Find email", () => findAgentEmailAction(leadId))} className="btn-secondary">
            Find email
          </button>
        )}
        <button
          disabled={isPending || !hasEmail}
          onClick={() => run("Send outreach email", () => sendOutreachEmailAction(leadId))}
          className="btn-primary"
        >
          Send outreach email
        </button>
        <button disabled={isPending} onClick={() => run("Mark replied", () => markAgentRepliedAction(leadId))} className="btn-secondary">
          Mark replied
        </button>
        <button disabled={isPending} onClick={() => run("Mark bounced", () => markAgentBouncedAction(leadId))} className="btn-secondary">
          Mark bounced
        </button>
        <button
          disabled={isPending}
          onClick={() => run("Mark opted out", () => markAgentOptedOutAction(leadId))}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-300 px-3.5 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
        >
          Mark opted out (STOP)
        </button>
      </div>

      {message && <p className="text-sm text-zinc-600 dark:text-zinc-400">{message}</p>}
    </div>
  );
}
