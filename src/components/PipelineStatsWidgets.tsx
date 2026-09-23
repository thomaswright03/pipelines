import type { Breakdown } from "@/lib/pipeline-stats";

export function StatCard({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: string | number;
  sublabel?: string;
}) {
  return (
    <div className="card card-hover p-4">
      <div className="accent-text text-2xl font-bold">{value}</div>
      <div className="text-xs text-zinc-500">{label}</div>
      {sublabel && <div className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">{sublabel}</div>}
    </div>
  );
}

export function StatSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card flex flex-col gap-3 p-4">
      <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{title}</h2>
      {children}
    </div>
  );
}

export function BreakdownList({ items, emptyLabel }: { items: Breakdown; emptyLabel: string }) {
  if (items.length === 0) {
    return <p className="text-sm text-zinc-500">{emptyLabel}</p>;
  }
  const max = Math.max(...items.map((i) => i.count), 1);
  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-2 text-sm">
          <div className="w-40 shrink-0 truncate text-zinc-600 dark:text-zinc-400">{item.label}</div>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all"
              style={{ width: `${(item.count / max) * 100}%` }}
            />
          </div>
          <div className="w-8 shrink-0 text-right font-medium">{item.count}</div>
        </div>
      ))}
    </div>
  );
}

export function DayTrend({ points }: { points: { day: string; count: number }[] }) {
  const max = Math.max(...points.map((p) => p.count), 1);
  return (
    <div className="flex items-end gap-1" style={{ height: "64px" }}>
      {points.map((p) => (
        <div key={p.day} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1" style={{ height: "100%" }}>
          <div
            className="w-full rounded-t bg-gradient-to-t from-indigo-600 to-violet-400 transition-all"
            style={{ height: `${Math.max((p.count / max) * 100, p.count > 0 ? 6 : 2)}%` }}
            title={`${p.day}: ${p.count}`}
          />
          <div className="truncate text-[10px] text-zinc-400">{p.day.slice(5).replace("-", "/")}</div>
        </div>
      ))}
    </div>
  );
}

export function formatPercent(value: number | null): string {
  if (value === null) return "—";
  return `${Math.round(value * 100)}%`;
}
