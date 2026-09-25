"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { findEmailsChunkAction } from "@/lib/actions/outreach";
import type { PipelineId } from "@/lib/outreach/pipeline-id";
import ActionMessage, { type Feedback } from "@/components/ActionMessage";

type Progress = { checked: number; found: number; unreachable: number; remaining: number };

/**
 * "Find emails for all leads": looks up an address for every lead that was
 * never checked, a few at a time, with live progress and a Stop button.
 * Leads with no findable email move to the phone lists.
 */
export default function FindEmailsButton({
  pipeline,
  disabled,
  epoch,
  startControl,
}: {
  pipeline: PipelineId;
  disabled?: boolean;
  /** See OutreachControls: this button's message shows only while it was the last control used. */
  epoch?: number;
  startControl?: () => number;
}) {
  const router = useRouter();
  const stopRequested = useRef(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [stopping, setStopping] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [startedEpoch, setStartedEpoch] = useState<number | undefined>(undefined);

  async function run() {
    setStartedEpoch(startControl?.());
    stopRequested.current = false;
    setStopping(false);
    setFeedback(null);
    const totals: Progress = { checked: 0, found: 0, unreachable: 0, remaining: 0 };
    setProgress({ ...totals });
    let error: string | null = null;

    for (;;) {
      if (stopRequested.current) break;
      let chunk;
      try {
        chunk = await findEmailsChunkAction(pipeline);
      } catch {
        error = "Lost contact with the server. Progress so far is saved — run it again to continue.";
        break;
      }
      if (!chunk.ok) {
        error = chunk.error;
        break;
      }
      totals.checked += chunk.result.checked;
      totals.found += chunk.result.found;
      totals.unreachable += chunk.result.unreachable;
      totals.remaining = chunk.result.remaining;
      setProgress({ ...totals });
      if (chunk.result.remaining === 0 || chunk.result.checked + chunk.result.unreachable === 0) break;
    }

    setProgress(null);
    const unreachable = totals.unreachable
      ? ` ${totals.unreachable} website${totals.unreachable === 1 ? "" : "s"} couldn't be reached — those leads were left as they are and will be tried again in an hour.`
      : "";
    const summary = `Checked ${totals.checked} lead${totals.checked === 1 ? "" : "s"}, found ${totals.found} email${totals.found === 1 ? "" : "s"}. Leads with none were moved to the phone lists.${unreachable}`;
    if (error) setFeedback({ ok: false, text: `${error} ${summary}` });
    else if (stopRequested.current) setFeedback({ ok: true, text: `Stopped. ${summary} ${totals.remaining} still to check.` });
    else
      setFeedback({
        ok: true,
        text: totals.checked + totals.unreachable === 0 ? "Every lead has already been checked for an email." : summary,
      });
    router.refresh();
  }

  const done = progress ? progress.checked + progress.unreachable : 0;
  const total = progress ? done + progress.remaining : 0;
  const pct = progress && total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="flex flex-col gap-2">
      {progress ? (
        <div className="flex flex-col gap-1.5" aria-live="polite">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm">
              Finding emails… {done} of {total || "?"} looked up, {progress.found} found
              {progress.unreachable > 0 && `, ${progress.unreachable} site${progress.unreachable === 1 ? "" : "s"} unreachable`}.
            </p>
            <button
              type="button"
              disabled={stopping}
              onClick={() => {
                stopRequested.current = true;
                setStopping(true);
              }}
              className="btn-danger"
            >
              {stopping ? "Stopping…" : "Stop"}
            </button>
          </div>
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-label="Email lookup progress"
          >
            <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      ) : (
        <button type="button" onClick={run} disabled={disabled} className="btn-secondary self-start">
          Look up emails for leads without one
        </button>
      )}
      <ActionMessage feedback={startedEpoch === epoch ? feedback : null} />
    </div>
  );
}
