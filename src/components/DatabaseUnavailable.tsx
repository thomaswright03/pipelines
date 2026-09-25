"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

/** The page body while the database can't be reached: what that means and what to do. */
export default function DatabaseUnavailable({ onRetry }: { onRetry?: () => void }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <div role="alert" className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
      <p className="text-lg font-semibold">Can&apos;t reach the database right now</p>
      <p className="max-w-md text-sm muted">
        Nothing can load or be saved until it&apos;s back — no emails are being sent in the meantime. Wait a minute, then
        press Try again. If it keeps happening, check the database provider&apos;s status page (Neon) or ask your developer.
      </p>
      <button
        type="button"
        disabled={isPending}
        onClick={() => startTransition(() => (onRetry ? onRetry() : router.refresh()))}
        className="btn-primary mt-2"
      >
        {isPending ? "Trying…" : "Try again"}
      </button>
    </div>
  );
}
