"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setLeadStarredAction } from "@/lib/actions/vault-pipeline";

export default function VaultStarButton({ leadId, starred }: { leadId: string; starred: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await setLeadStarredAction(leadId, !starred);
          router.refresh();
        })
      }
      className={`text-lg leading-none transition hover:scale-125 active:scale-95 ${starred ? "text-amber-500" : "text-zinc-300 hover:text-amber-400"}`}
      aria-label={starred ? "Unstar" : "Star"}
    >
      {starred ? "★" : "☆"}
    </button>
  );
}
