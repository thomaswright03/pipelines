import type { BaseStats, Breakdown } from "@/lib/pipeline-stats";
import { statusLabel } from "@/lib/lead-status";
import { APP_TIME_ZONE_LABEL } from "@/lib/time";

export function StatCard({ label, value, sublabel }: { label: string; value: string | number; sublabel?: string }) {
  return (
    <div className="card p-4">
      <div className="accent-text text-2xl font-bold">{typeof value === "number" ? value.toLocaleString("en-US") : value}</div>
      <div className="text-xs text-zinc-700 dark:text-zinc-300">{label}</div>
      {sublabel && <div className="mt-1 text-xs muted">{sublabel}</div>}
    </div>
  );
}

export function StatSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card flex flex-col gap-3 p-4">
      <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{title}</h2>
      {children}
    </section>
  );
}

export function BreakdownList({ items, emptyLabel }: { items: Breakdown; emptyLabel: string }) {
  if (items.length === 0) {
    return <p className="text-sm muted">{emptyLabel}</p>;
  }
  const max = Math.max(...items.map((i) => i.count), 1);
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2 text-sm">
          <div className="w-32 shrink-0 truncate muted sm:w-40" title={item.label}>
            {item.label}
          </div>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800" aria-hidden>
            <div
              className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all"
              style={{ width: `${(item.count / max) * 100}%` }}
            />
          </div>
          <div className="w-10 shrink-0 text-right font-medium">{item.count.toLocaleString("en-US")}</div>
        </li>
      ))}
    </ul>
  );
}

export function DayTrend({ points, noun }: { points: { day: string; count: number }[]; noun: string }) {
  const max = Math.max(...points.map((p) => p.count), 1);
  const total = points.reduce((sum, p) => sum + p.count, 0);
  return (
    <figure>
      <div className="flex items-end gap-1" style={{ height: "64px" }} aria-hidden>
        {points.map((p) => (
          <div key={p.day} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1" style={{ height: "100%" }}>
            <div
              className="w-full rounded-t bg-gradient-to-t from-indigo-600 to-violet-400 transition-all"
              style={{ height: `${Math.max((p.count / max) * 100, p.count > 0 ? 6 : 2)}%` }}
              title={`${p.day}: ${p.count}`}
            />
            <div className="truncate text-[10px] text-zinc-600 dark:text-zinc-400">{p.day.slice(5).replace("-", "/")}</div>
          </div>
        ))}
      </div>
      <figcaption className="sr-only">
        {total} {noun} over the last {points.length} days: {points.map((p) => `${p.day} ${p.count}`).join(", ")}.
      </figcaption>
    </figure>
  );
}

function formatPercent(value: number | null): string {
  if (value === null) return "—";
  return `${Math.round(value * 100)}%`;
}

const n = (value: number) => value.toLocaleString("en-US");

/** "6 of 21 leads that got past New (29%)" — every rate names what it's a share of. */
export function shareOf(numerator: number, denominator: number, what: string): string {
  if (denominator === 0) return `none yet — no ${what}`;
  return `${n(numerator)} of ${n(denominator)} ${what} (${formatPercent(numerator / denominator)})`;
}

/** The numbers both pipelines share, with how each rate is worked out. */
export function EmailPerformance({
  s,
  conversion,
}: {
  s: BaseStats;
  /** `label` is the outcome counted, e.g. "Appointment or better"; its share is of leads past New. */
  conversion: { label: string; value: number };
}) {
  return (
    <StatSection title="Email performance">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Emails sent (all time)" value={s.emailsSentTotal} sublabel={`to ${s.leadsEmailed.toLocaleString("en-US")} distinct leads`} />
        <StatCard label="Sent today" value={s.emailsSentToday} />
        <StatCard label="Sent, last 7 days" value={s.emailsSentLast7Days} />
        <StatCard label="Sent, last 30 days" value={s.emailsSentLast30Days} />
        <StatCard label="Replied" value={s.replied} sublabel={shareOf(s.replied, s.leadsEmailed, "emailed leads replied")} />
        <StatCard label="Bounced" value={s.bounced} sublabel={shareOf(s.bounced, s.emailsSentTotal, "emails sent bounced")} />
        <StatCard label="We replied back" value={s.weReplied} sublabel={shareOf(s.weReplied, s.replied, "leads who replied got an answer")} />
        <StatCard
          label={conversion.label}
          value={conversion.value}
          sublabel={shareOf(conversion.value, s.pastNew, "leads that got past New")}
        />
      </div>
      <p className="text-xs muted">
        A reply counts whenever it arrives, even after the lead moved to the call deck. “Past New” means any status other than
        New. “Today” and the daily bars use calendar days in {APP_TIME_ZONE_LABEL}.
      </p>
    </StatSection>
  );
}

export function StatusBreakdown({ counts, statuses, emptyLabel }: { counts: Record<string, number>; statuses: readonly string[]; emptyLabel: string }) {
  const items = statuses.map((status) => ({ label: statusLabel(status), count: counts[status] ?? 0 })).filter((i) => i.count > 0);
  return <BreakdownList items={items} emptyLabel={emptyLabel} />;
}
