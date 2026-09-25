"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  markLeadLostAction,
  markResponseAsNonDeliveryAction,
  scheduleAppointmentAction,
} from "@/lib/actions/vault-pipeline";
import type { ActionResult } from "@/lib/outreach/lead-actions";
import { APP_TIME_ZONE_LABEL } from "@/lib/time";
import { APPOINTMENT_FROM } from "@/lib/lead-status";
import ActionMessage, { type Feedback } from "@/components/ActionMessage";
import { useConfirm } from "@/components/ConfirmDialog";

const LOST_REASONS = [
  { value: "not_interested", label: "Not interested" },
  { value: "too_busy", label: "Too busy" },
  { value: "no_answer", label: "No answer" },
  { value: "no_need", label: "No need" },
  { value: "unable_to_contact", label: "Unable to contact" },
] as const;


// Cold Outreach–only stage actions: appointments, Lost with a reason, the
// "that reply was really a bounce" correction.
export default function ColdOutreachStagePanel({
  lead,
  appointmentInputValue,
}: {
  lead: { id: string; name: string; status: string; email: string | null; replied: boolean };
  /** The current appointment as a datetime-local value in the app's zone, or "". */
  appointmentInputValue: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [appointmentAt, setAppointmentAt] = useState(appointmentInputValue);
  const [lostReason, setLostReason] = useState<string>("");
  const [dialog, confirm] = useConfirm();

  function run(fn: () => Promise<ActionResult>) {
    setFeedback(null);
    startTransition(async () => {
      try {
        const result = await fn();
        setFeedback(result.ok ? { ok: true, text: result.message } : { ok: false, text: result.error });
      } catch {
        setFeedback({ ok: false, text: "Couldn't reach the server — nothing was changed. Try again." });
      }
      router.refresh();
    });
  }

  async function markLost(e: React.FormEvent) {
    e.preventDefault();
    if (!lostReason) {
      setFeedback({ ok: false, text: "Pick why the lead was lost first." });
      return;
    }
    const label = LOST_REASONS.find((r) => r.value === lostReason)?.label ?? lostReason;
    if (await confirm({ title: `Mark ${lead.name} as Lost?`, body: <p>Reason: {label}.</p>, confirmLabel: "Mark lost", danger: true })) {
      run(() => markLeadLostAction(lead.id, lostReason));
    }
  }

  async function nonDelivery() {
    const confirmed = await confirm({
      title: "Was that reply really a bounce?",
      body: <p>Clears the reply, records the send as bounced and moves {lead.name} to phone outreach.</p>,
      confirmLabel: "Record as bounce",
      danger: true,
    });
    if (confirmed) run(() => markResponseAsNonDeliveryAction(lead.id));
  }

  const canAppoint = APPOINTMENT_FROM.includes(lead.status);
  const canCorrectReply = lead.status === "responded" && lead.replied;
  if (!canAppoint && lead.status === "lost" && !canCorrectReply && !feedback) return null;

  return (
    <section aria-labelledby="stage-heading" className="card flex flex-col gap-3 p-4">
      {dialog}
      <h2 id="stage-heading" className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
        Pipeline stage
      </h2>

      {canAppoint && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!appointmentAt) {
              setFeedback({ ok: false, text: "Pick a date and time for the appointment." });
              return;
            }
            run(() => scheduleAppointmentAction(lead.id, appointmentAt));
          }}
          className="flex flex-col gap-1"
        >
          <label htmlFor="appointment" className="field-label">
            Appointment ({APP_TIME_ZONE_LABEL})
          </label>
          <div className="flex gap-2">
            <input
              id="appointment"
              type="datetime-local"
              value={appointmentAt}
              onChange={(e) => setAppointmentAt(e.target.value)}
              className="input min-w-0 flex-1"
            />
            <button type="submit" disabled={isPending} className="btn-secondary">
              {lead.status === "appointment_set" ? "Update" : "Set"}
            </button>
          </div>
        </form>
      )}

      {lead.status !== "lost" && (
        <form onSubmit={markLost} className="flex flex-col gap-1">
          <label htmlFor="lost-reason" className="field-label">
            Mark lost
          </label>
          <div className="flex gap-2">
            <select id="lost-reason" value={lostReason} onChange={(e) => setLostReason(e.target.value)} className="input min-w-0 flex-1">
              <option value="">Why?</option>
              {LOST_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <button type="submit" disabled={isPending} className="btn-danger">
              Lost
            </button>
          </div>
        </form>
      )}

      {canCorrectReply && (
        <button type="button" disabled={isPending} onClick={nonDelivery} className="btn-secondary">
          That reply was a bounce
        </button>
      )}


      <ActionMessage feedback={feedback} />
    </section>
  );
}
