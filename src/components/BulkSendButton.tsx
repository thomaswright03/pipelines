"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { previewBulkSendAction, sendBulkChunkAction } from "@/lib/actions/outreach";
import type { BulkPreview } from "@/lib/outreach/send";
import type { PipelineId } from "@/lib/outreach/pipeline-id";
import { plural } from "@/lib/format";
import { bulkSendSummary, runBulkSend, type BulkProgress } from "@/lib/bulk-send-run";

type Progress = BulkProgress;

type Phase =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "preview"; preview: BulkPreview }
  | { kind: "sending"; preview: BulkPreview; progress: Progress; stopping: boolean }
  | { kind: "done"; progress: Progress; summary: string; tone: "success" | "warning" | "error" }
  | { kind: "error"; message: string };

/**
 * "Send outreach to new leads": shows exactly who would be emailed (count,
 * distinct addresses, what's skipped and why, a sample) and sends only
 * after an explicit "Send to N leads". The send runs as one server call per
 * email, so progress is visible and Stop takes effect after the email in
 * progress.
 */
export default function BulkSendButton({ pipeline, disabled }: { pipeline: PipelineId; disabled?: boolean }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const stopRequested = useRef(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const sendRef = useRef<HTMLButtonElement>(null);

  // Once the preview is shown, Enter sends (the button names exactly how many).
  useEffect(() => {
    if (phase.kind === "preview") sendRef.current?.focus();
  }, [phase.kind]);

  async function open() {
    setPhase({ kind: "loading" });
    dialogRef.current?.showModal();
    try {
      const result = await previewBulkSendAction(pipeline);
      setPhase(result.ok ? { kind: "preview", preview: result.preview } : { kind: "error", message: result.error });
    } catch {
      setPhase({ kind: "error", message: "Couldn't reach the server — nothing was sent. Check your connection and try again." });
    }
  }

  function close() {
    if (phase.kind === "sending") return;
    dialogRef.current?.close();
    setPhase({ kind: "idle" });
  }

  async function send(preview: BulkPreview) {
    stopRequested.current = false;
    const initial: Progress = { sent: 0, skipped: 0, failed: 0, processed: 0, total: preview.leadIds.length, messages: [] };
    setPhase({ kind: "sending", preview, progress: initial, stopping: false });
    const { progress, stopReason } = await runBulkSend(
      preview.leadIds,
      (ids, consecutiveFailures) => sendBulkChunkAction(pipeline, ids, consecutiveFailures),
      {
        shouldStop: () => stopRequested.current,
        onProgress: (p) => setPhase((current) => (current.kind === "sending" ? { ...current, progress: p } : current)),
      },
    );
    setPhase({ kind: "done", progress, ...bulkSendSummary(progress, stopReason, preview) });
    router.refresh();
  }

  return (
    <>
      <button type="button" onClick={open} disabled={disabled || phase.kind !== "idle"} className="btn-secondary">
        Send outreach to new leads…
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby={`bulk-title-${pipeline}`}
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
        className="m-auto w-[min(34rem,calc(100vw-2rem))] rounded-xl border border-zinc-200 bg-white p-5 text-zinc-900 shadow-xl dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
      >
        <h2 id={`bulk-title-${pipeline}`} className="text-base font-semibold">
          Send outreach to new leads
        </h2>
        <div className="mt-3 flex flex-col gap-3 text-sm">
          {phase.kind === "loading" && <p className="muted">Working out who would be emailed…</p>}
          {phase.kind === "error" && <p className="notice-error">{phase.message}</p>}
          {phase.kind === "preview" && <PreviewBody preview={phase.preview} />}
          {phase.kind === "sending" && (
            <ProgressBody progress={phase.progress} willSend={phase.preview.willSend} stopping={phase.stopping} />
          )}
          {phase.kind === "done" && (
            <>
              <p className={phase.tone === "success" ? "notice-success" : phase.tone === "warning" ? "notice-warning" : "notice-error"}>
                {phase.summary}
              </p>
              <Messages messages={phase.progress.messages} />
            </>
          )}
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {phase.kind === "preview" && (
            <>
              <button type="button" onClick={close} className="btn-secondary">
                Cancel
              </button>
              {!phase.preview.paused && phase.preview.willSend > 0 && (
                <button ref={sendRef} type="button" onClick={() => send(phase.preview)} className="btn-primary">
                  Send to {plural(phase.preview.willSend, "lead")}
                </button>
              )}
            </>
          )}
          {phase.kind === "sending" && (
            <button
              type="button"
              disabled={phase.stopping}
              onClick={() => {
                stopRequested.current = true;
                setPhase((p) => (p.kind === "sending" ? { ...p, stopping: true } : p));
              }}
              className="btn-danger"
            >
              {phase.stopping ? "Stopping after this email…" : "Stop sending"}
            </button>
          )}
          {(phase.kind === "done" || phase.kind === "error" || phase.kind === "loading") && (
            <button type="button" onClick={close} disabled={phase.kind === "loading"} className="btn-secondary">
              Close
            </button>
          )}
        </div>
      </dialog>
    </>
  );
}

function PreviewBody({ preview }: { preview: BulkPreview }) {
  if (preview.paused) {
    return <p className="notice-warning">Outbound email is paused, so nothing can be sent. Resume it on the Settings page first.</p>;
  }
  const skippedParts = [
    preview.skipped.alreadyPitched && `${plural(preview.skipped.alreadyPitched, "lead")} whose address was already pitched`,
    preview.skipped.duplicateInBatch &&
      `${plural(preview.skipped.duplicateInBatch, "lead")} sharing an address with another lead in this batch`,
    preview.skipped.suppressed && `${plural(preview.skipped.suppressed, "lead")} on the do-not-email list`,
  ].filter(Boolean);
  if (preview.willSend === 0) {
    return (
      <p className="notice-info">
        Nothing to send.{" "}
        {preview.totalEligible === 0
          ? "No New leads have an email address."
          : `All ${plural(preview.totalEligible, "New lead")} with an email would be skipped: ${skippedParts.join("; ")}.`}
      </p>
    );
  }
  return (
    <>
      <p>
        This sends the first outreach email to <strong>{plural(preview.willSend, "lead")}</strong> at{" "}
        <strong>{plural(preview.distinctAddresses, "distinct address", "distinct addresses")}</strong>, about one per second. Each lead
        moves to Contacted as it&apos;s emailed.
      </p>
      {preview.totalEligible > preview.leadIds.length && (
        <p className="muted">
          {plural(preview.totalEligible, "New lead")} have an email; one batch covers at most {preview.batchLimit}. Run it again afterwards
          for the rest.
        </p>
      )}
      {skippedParts.length > 0 && <p className="muted">Skipped: {skippedParts.join("; ")}.</p>}
      <div>
        <p className="font-medium">First {preview.sample.length}:</p>
        <ul className="mt-1 list-disc pl-5">
          {preview.sample.map((s) => (
            <li key={s.email} className="break-words">
              {s.name} — {s.email}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

function ProgressBody({ progress, willSend, stopping }: { progress: Progress; willSend: number; stopping: boolean }) {
  const pct = Math.min(100, Math.round((progress.processed / Math.max(progress.total, 1)) * 100));
  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      <p>
        Sent {progress.sent} of {willSend}
        {progress.skipped ? ` · ${progress.skipped} skipped` : ""}
        {progress.failed ? ` · ${progress.failed} failed` : ""}
        {stopping ? " · stopping…" : "…"}
      </p>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label="Send progress"
      >
        <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-sm muted">Keep this tab open until it finishes. Closing it stops the send after the current email.</p>
    </div>
  );
}

function Messages({ messages }: { messages: string[] }) {
  if (messages.length === 0) return null;
  return (
    <details>
      <summary className="cursor-pointer text-sm font-medium">Details ({messages.length})</summary>
      <ul className="mt-1 max-h-48 list-disc overflow-y-auto pl-5 text-sm muted">
        {messages.map((m, i) => (
          <li key={i} className="break-words">
            {m}
          </li>
        ))}
      </ul>
    </details>
  );
}
