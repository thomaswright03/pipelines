import type { ConnectionStatus, StatusTone } from "@/lib/integration-status";
import TestConnectionButton from "@/components/TestConnectionButton";

const TONE: Record<StatusTone, { label: string; dot: string; badge: string }> = {
  ok: {
    label: "Working",
    dot: "bg-emerald-500",
    badge: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200",
  },
  warn: {
    label: "Check",
    dot: "bg-amber-500",
    badge: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  },
  error: {
    label: "Not working",
    dot: "bg-red-600",
    badge: "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200",
  },
};

/** One row per outside service: a state badge, what's true now, and what to do if anything. */
export default function ConnectionStatusList({ items }: { items: ConnectionStatus[] }) {
  return (
    <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800">
      {items.map((item) => {
        const tone = TONE[item.tone];
        return (
          <li key={item.key} data-connection={item.key} data-tone={item.tone} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">{item.label}</span>
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${tone.badge}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} aria-hidden />
                {item.badge ?? tone.label}
              </span>
            </div>
            <p className="break-words text-sm">{item.summary}</p>
            {item.next && <p className="text-sm muted">Next step: {item.next}</p>}
            {item.testable && (item.key === "mail" || item.key === "yelp") && (
              <TestConnectionButton service={item.key} label={item.label} />
            )}
          </li>
        );
      })}
    </ul>
  );
}
