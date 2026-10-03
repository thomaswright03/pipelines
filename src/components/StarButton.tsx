"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setStarredAction } from "@/lib/actions/outreach";
import type { PipelineId } from "@/lib/outreach/pipeline-id";
import { unconfirmedMessage } from "@/components/ActionMessage";

export default function StarButton({
  pipeline,
  leadId,
  leadName,
  starred,
}: {
  pipeline: PipelineId;
  leadId: string;
  leadName: string;
  starred: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic(starred);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setShown(!shown);
            setError(null);
            try {
              const result = await setStarredAction(pipeline, leadId, !shown);
              if (!result.ok) setError(result.error);
            } catch {
              setError(unconfirmedMessage("the star was saved"));
            }
            router.refresh();
          })
        }
        className={`inline-flex h-11 w-11 items-center justify-center text-lg leading-none transition hover:scale-110 active:scale-95 sm:h-8 sm:w-8 ${
          shown ? "text-amber-600 dark:text-amber-400" : "text-zinc-500 hover:text-amber-600 dark:text-zinc-400"
        }`}
        aria-label={shown ? `Unstar ${leadName}` : `Star ${leadName}`}
        aria-pressed={shown}
      >
        {shown ? "★" : "☆"}
      </button>
      {error && (
        <div role="alert" className="notice-error fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md items-start gap-3 shadow-lg">
          <p className="flex-1 text-sm">{error}</p>
          <button type="button" onClick={() => setError(null)} className="btn-ghost -my-1 shrink-0">
            Dismiss
          </button>
        </div>
      )}
    </>
  );
}
