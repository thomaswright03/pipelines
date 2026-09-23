"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  findLeadEmailAction,
  sendOutreachEmailAction,
  updateLeadStatusAction,
  setOurReplyAction,
  markLeadRepliedAction,
  markLeadBouncedAction,
  markLeadOptedOutAction,
  scheduleAppointmentAction,
  markWorkingForAction,
  markPayingClientAction,
  markLeadLostAction,
  markResponseAsNonDeliveryAction,
  viewLeadEmailThreadAction,
} from "@/lib/actions/vault-pipeline";

const STATUSES = [
  "new",
  "contacted",
  "responded",
  "appointment_set",
  "working_for",
  "paying_client",
  "cold_call_list",
  "contactless_list",
  "lost",
];

const LOST_REASONS = [
  { value: "not_interested", label: "Not interested" },
  { value: "too_busy", label: "Too busy" },
  { value: "no_answer", label: "No answer" },
  { value: "no_need", label: "No need" },
  { value: "unable_to_contact", label: "Unable to contact" },
] as const;

export default function VaultLeadActions({
  leadId,
  status,
  hasEmail,
  email,
  ourReplyAt,
}: {
  leadId: string;
  status: string;
  hasEmail: boolean;
  email: string | null;
  ourReplyAt: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [appointmentAt, setAppointmentAt] = useState("");
  const [lostReason, setLostReason] = useState(LOST_REASONS[0].value);

  function run(label: string, fn: () => Promise<{ error?: string } & Record<string, unknown>> | Promise<void>) {
    setMessage(null);
    startTransition(async () => {
      const result = await fn();
      const error = result && typeof result === "object" && "error" in result ? result.error : undefined;
      setMessage(error ? `${label} failed: ${error}` : `${label}: done.`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="card flex flex-col gap-3 p-4">
        <div>
          <label className="text-xs text-zinc-500">Status</label>
          <select
            defaultValue={status}
            disabled={isPending}
            onChange={(e) => run("Update status", () => updateLeadStatusAction(leadId, e.target.value))}
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
            <ActionButton disabled={isPending} onClick={() => run("Find email", () => findLeadEmailAction(leadId))}>
              Find email
            </ActionButton>
          )}
          <ActionButton disabled={isPending || !hasEmail} primary onClick={() => run("Send outreach email", () => sendOutreachEmailAction(leadId))}>
            Send outreach email
          </ActionButton>
          <ActionButton disabled={isPending || status !== "contacted"} onClick={() => run("Mark replied", () => markLeadRepliedAction(leadId))}>
            Mark replied
          </ActionButton>
          <ActionButton disabled={isPending} onClick={() => run("Mark bounced", () => markLeadBouncedAction(leadId))}>
            Mark bounced
          </ActionButton>
          <button
            disabled={isPending}
            onClick={() => run("Mark opted out", () => markLeadOptedOutAction(leadId))}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-300 px-3.5 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
          >
            Mark opted out (STOP)
          </button>
          {email && (
            <ActionButton disabled={isPending} onClick={() => run("Open thread", () => viewLeadEmailThreadAction(email))}>
              View email thread in Mail (this Mac only)
            </ActionButton>
          )}
          <ActionButton
            disabled={isPending}
            onClick={() =>
              run(ourReplyAt ? "Unmark our reply" : "Mark we replied", () => setOurReplyAction(leadId, !ourReplyAt))
            }
          >
            {ourReplyAt ? "Unmark “we replied”" : "Mark “we replied”"}
          </ActionButton>
          <ActionButton disabled={isPending} onClick={() => run("Mark non-delivery", () => markResponseAsNonDeliveryAction(leadId))}>
            This was actually a bounce, not a reply
          </ActionButton>
        </div>

        {message && <p className="text-sm text-zinc-600 dark:text-zinc-400">{message}</p>}
      </div>

      <div className="card flex flex-col gap-2 p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Pipeline stage</h2>

        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          Set appointment
          <div className="flex gap-2">
            <input
              type="datetime-local"
              value={appointmentAt}
              onChange={(e) => setAppointmentAt(e.target.value)}
              className="input flex-1"
            />
            <button
              disabled={isPending || !appointmentAt}
              onClick={() => run("Schedule appointment", () => scheduleAppointmentAction(leadId, appointmentAt))}
              className="btn-secondary"
            >
              Set
            </button>
          </div>
        </label>

        <ActionButton disabled={isPending} onClick={() => run("Mark working for", () => markWorkingForAction(leadId))}>
          Mark &quot;working for&quot;
        </ActionButton>
        <ActionButton disabled={isPending} onClick={() => run("Mark paying client", () => markPayingClientAction(leadId))}>
          Mark &quot;paying client&quot;
        </ActionButton>

        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          Mark lost
          <div className="flex gap-2">
            <select
              value={lostReason}
              onChange={(e) => setLostReason(e.target.value as typeof lostReason)}
              className="input flex-1"
            >
              {LOST_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <button
              disabled={isPending}
              onClick={() => run("Mark lost", () => markLeadLostAction(leadId, lostReason))}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-300 px-3.5 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
            >
              Lost
            </button>
          </div>
        </label>
      </div>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  primary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled} className={primary ? "btn-primary" : "btn-secondary"}>
      {children}
    </button>
  );
}
