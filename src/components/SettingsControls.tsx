"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setAllowCrossPipelineRepeatsAction, setOutboundPausedAction } from "@/lib/actions/settings";
import type { ActionResult } from "@/lib/outreach/lead-actions";
import ActionMessage, { type Feedback, unconfirmedMessage } from "@/components/ActionMessage";
import { useConfirm } from "@/components/ConfirmDialog";

export default function SettingsControls({
  paused,
  offByEnvironment = false,
  pausedSince,
  allowCrossPipelineRepeats,
}: {
  /** The pause switch below. */
  paused: boolean;
  /** OUTBOUND_EMAIL_DISABLED is set on the server: nothing is sent whatever the switch says. */
  offByEnvironment?: boolean;
  pausedSince: string | null;
  allowCrossPipelineRepeats: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [dialog, confirm] = useConfirm();

  function run(fn: () => Promise<ActionResult>) {
    setFeedback(null);
    startTransition(async () => {
      try {
        const result = await fn();
        setFeedback(result.ok ? { ok: true, text: result.message } : { ok: false, text: result.error });
      } catch {
        setFeedback({ ok: false, text: unconfirmedMessage("the setting changed") });
      }
      router.refresh();
    });
  }

  async function togglePause() {
    if (paused) {
      const ok = await confirm({
        title: "Resume outbound email?",
        body: <p>Manual sends, bulk sends and the daily run will send email again.</p>,
        confirmLabel: "Resume sending",
      });
      if (ok) run(() => setOutboundPausedAction(false));
    } else {
      run(() => setOutboundPausedAction(true));
    }
  }

  async function toggleRepeats() {
    if (!allowCrossPipelineRepeats) {
      const ok = await confirm({
        title: "Let each pipeline pitch the same address?",
        body: (
          <p>
            An address that already got one pipeline&apos;s pitch (Cold Outreach, dataleadsell.com or Garbage AI) could also get each of the
            others&apos;. Every pipeline still sends at most once per address, and the do-not-email list still blocks all of them.
          </p>
        ),
        confirmLabel: "Allow",
      });
      if (ok) run(() => setAllowCrossPipelineRepeatsAction(true));
    } else {
      run(() => setAllowCrossPipelineRepeatsAction(false));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {dialog}
      <section aria-labelledby="pause-heading" className="card flex flex-col gap-3 p-4">
        <h2 id="pause-heading" className="flex items-center gap-2 text-base font-semibold">
          <span className={`h-2 w-2 rounded-full ${paused || offByEnvironment ? "bg-red-500" : "bg-emerald-500"}`} aria-hidden />
          Outbound email: {offByEnvironment ? "off (server setting)" : paused ? "paused" : "on"}
        </h2>
        {offByEnvironment && (
          <p className="notice-warning">
            <strong>Switched off on the server.</strong> OUTBOUND_EMAIL_DISABLED is set in the hosting environment, so nothing is sent from
            any pipeline whatever the switch below says. Sending comes back only when that variable is removed and the app redeployed.
          </p>
        )}
        <p className="text-sm muted">
          {paused
            ? `Paused${pausedSince ? ` since ${pausedSince}` : ""}. Nothing is sent from any pipeline — manual, bulk or a daily run — until you resume.`
            : "The emergency stop. Pausing takes effect on the very next send, including one in the middle of a bulk send. If this page can't be reached, set OUTBOUND_EMAIL_DISABLED=1 in the hosting dashboard instead (see the operator guide)."}
        </p>
        <button
          type="button"
          disabled={isPending}
          onClick={togglePause}
          className={paused ? "btn-primary self-start" : "btn-danger-solid self-start"}
        >
          {paused ? "Resume outbound email" : "Pause all outbound email"}
        </button>
      </section>

      <section aria-labelledby="repeat-heading" className="card flex flex-col gap-3 p-4">
        <h2 id="repeat-heading" className="text-base font-semibold">
          Same address across pipelines
        </h2>
        <p className="text-sm muted">
          {allowCrossPipelineRepeats
            ? "Allowed: an address pitched by one pipeline can also be pitched by each of the others (once per pipeline)."
            : "Not allowed (default): each address gets at most one cold pitch across all pipelines, whichever sends it first."}
        </p>
        <button type="button" disabled={isPending} onClick={toggleRepeats} className="btn-secondary self-start">
          {allowCrossPipelineRepeats ? "Go back to one pitch per address" : "Allow one pitch per pipeline"}
        </button>
      </section>

      <ActionMessage feedback={feedback} />
    </div>
  );
}
