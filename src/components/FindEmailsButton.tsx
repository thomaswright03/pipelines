"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { findEmailsChunkAction } from "@/lib/actions/outreach";
import type { PipelineId } from "@/lib/outreach/pipeline-id";
import ActionMessage, { type Feedback } from "@/components/ActionMessage";

type Progress = { checked: number; found: number; remaining: number };

/**
 * "Find emails for all leads": looks up an address for every lead that was
 * never checked, a few at a time, with live progress and a Stop button.
 * Leads with no findable email move to the phone lists.
 */
export default function FindEmailsButton({ pipeline, disabled }: { pipeline: PipelineId; disabled?: boolean }) {
  const router = useRouter();
  const stopRequested = useRef(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [stopping, setStopping] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  async function run() {
    stopRequested.current = false;
    setStopping(false);
    setFeedback(null);
    const totals: Progress = { checked: 0, found: 0, remaining: 0 };
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
      totals.remaining = chunk.result.remaining;
      setProgress({ ...totals });
      if (chunk.result.remaining === 0 || chunk.result.checked === 0) break;
    }

    setProgress(null);
    const summary = `Checked ${totals.checked} lead${totals.checked === 1 ? "" : "s"}, found ${totals.found} email${totals.found === 1 ? "" : "s"}. Leads with none were moved to the phone lists.`;
    if (error) setFeedback({ ok: false, text: `${error} ${summary}` });
    else if (stopRequested.current) setFeedback({ ok: true, text: `Stopped. ${summary} ${totals.remaining} still to check.` });
    else setFeedback({ ok: true, text: totals.checked === 0 ? "Every lead has already been checked for an email." : summary });
    router.refresh();
  }

  const total = progress ? progress.checked + progress.remaining : 0;
  const pct = progress && total > 0 ? Math.round((progress.checked / total) * 100) : 0;

  return (
    <div className="flex flex-col gap-2">
      {progress ? (
        <div className="flex flex-col gap-1.5" aria-live="polite">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm">
              Finding emails… {progress.checked} of {total || "?"} checked, {progress.found} found.
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
          Find emails for unchecked leads
        </button>
      )}
      <ActionMessage feedback={feedback} />
    </div>
  );
}
