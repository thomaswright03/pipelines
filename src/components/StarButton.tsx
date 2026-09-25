"use client";

import { useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setStarredAction } from "@/lib/actions/outreach";
import type { PipelineId } from "@/lib/outreach/pipeline-id";

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

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          setShown(!shown);
          const result = await setStarredAction(pipeline, leadId, !shown);
          if (!result.ok) window.alert(result.error);
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
  );
}
