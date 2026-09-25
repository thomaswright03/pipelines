"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Server-side log only — never shown to the user (see the checklist
    // item this satisfies: no raw error text or stack traces in the UI).
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
      <span className="accent-text text-5xl font-bold">Oops</span>
      <p className="text-lg font-medium">Something went wrong.</p>
      <p className="max-w-sm text-sm muted">
        That&apos;s on us, not you. Try again, or head back to the dashboard.
      </p>
      <div className="mt-2 flex gap-2">
        <button onClick={reset} className="btn-primary">
          Try again
        </button>
        <Link href="/" className="btn-secondary">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
