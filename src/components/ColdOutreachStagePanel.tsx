"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markResponseAsNonDeliveryAction, scheduleAppointmentAction } from "@/lib/actions/vault-pipeline";
import type { ActionResult } from "@/lib/outreach/lead-actions";
import { APP_TIME_ZONE_LABEL } from "@/lib/time";
import { APPOINTMENT_FROM } from "@/lib/lead-status";
import ActionMessage, { type Feedback, unconfirmedMessage } from "@/components/ActionMessage";
import { useConfirm } from "@/components/ConfirmDialog";

// Cold Outreach–only stage actions: appointments and the "that reply was
// really a bounce" correction. Marking a lead Lost (with a reason) is done
// from the status panel's "Move to…", the same in every pipeline.
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
  const [dialog, confirm] = useConfirm();

  function run(fn: () => Promise<ActionResult>) {
    setFeedback(null);
    startTransition(async () => {
      try {
        const result = await fn();
        setFeedback(result.ok ? { ok: true, text: result.message } : { ok: false, text: result.error });
      } catch {
        setFeedback({ ok: false, text: unconfirmedMessage("the change went through") });
      }
      router.refresh();
    });
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
  if (!canAppoint && !canCorrectReply && !feedback) return null;

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

      {canCorrectReply && (
        <button type="button" disabled={isPending} onClick={nonDelivery} className="btn-secondary">
          That reply was a bounce
        </button>
      )}

      <ActionMessage feedback={feedback} />
    </section>
  );
}
