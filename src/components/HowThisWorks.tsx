import type { ReactNode } from "react";

/** The longer explanation behind a page's main actions, collapsed until asked for. */
export default function HowThisWorks({ children, summary = "How this works" }: { children: ReactNode; summary?: string }) {
  return (
    <details className="text-sm muted">
      <summary className="cursor-pointer py-3 font-medium text-zinc-700 sm:py-0 dark:text-zinc-300">{summary}</summary>
      <div className="mt-1 flex flex-col gap-1">{children}</div>
    </details>
  );
}
