"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import DatabaseUnavailable from "@/components/DatabaseUnavailable";

// In production the error object carries no details (only a digest that
// matches the server log, where the real error is already logged), so the
// page asks /api/health whether the cause is a database outage and says so
// in plain words; anything else gets the generic message.
export default function ErrorPage({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const [database, setDatabase] = useState<"checking" | "ok" | "unreachable">("checking");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/health", { cache: "no-store" })
      .then((res) => (res.status === 503 ? "unreachable" : "ok"))
      .catch(() => "ok" as const) // can't tell: show the generic message
      .then((state) => {
        if (!cancelled) setDatabase(state);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (database === "checking") {
    return <div className="min-h-[50vh]" aria-busy="true" />;
  }
  if (database === "unreachable") return <DatabaseUnavailable onRetry={retry} />;

  return (
    <div role="alert" className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
      <span className="accent-text text-5xl font-bold">Oops</span>
      <p className="text-lg font-medium">Something went wrong.</p>
      <p className="max-w-sm text-sm muted">That&apos;s on us, not you. Try again, or head back to the dashboard.</p>
      <div className="mt-2 flex gap-2">
        <button onClick={() => retry()} className="btn-primary">
          Try again
        </button>
        <Link href="/" className="btn-secondary">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
