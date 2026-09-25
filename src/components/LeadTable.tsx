// The lead list shared by both pipelines: status tabs, search, sortable
// columns and pagination, all driven by the URL (see src/lib/lead-list.ts).
import Link from "next/link";
import Form from "next/form";
import StarButton from "@/components/StarButton";
import StatusBadge from "@/components/StatusBadge";
import { listHref, pageCount, PAGE_SIZE, type ListParams, type SortKey } from "@/lib/lead-list";
import { statusLabel } from "@/lib/lead-status";
import { formatDate } from "@/lib/time";
import type { PipelineId } from "@/lib/outreach/pipeline-id";

export type LeadRow = {
  id: string;
  name: string;
  subtitle: string | null;
  location: string;
  email: string | null;
  phone: string | null;
  status: string;
  lastEmailedAt: Date | null;
  createdAt: Date;
  starred: boolean;
  flagged: boolean;
};

export default function LeadTable({
  pipeline,
  basePath,
  params,
  rows,
  filteredTotal,
  total,
  statuses,
  statusCounts,
  locationLabel,
  noun,
}: {
  pipeline: PipelineId;
  basePath: string;
  params: ListParams;
  rows: LeadRow[];
  filteredTotal: number;
  total: number;
  statuses: readonly string[];
  statusCounts: Record<string, number>;
  locationLabel: string;
  noun: { one: string; many: string };
}) {
  const pages = pageCount(filteredTotal);
  const page = Math.min(params.page, pages);
  const from = filteredTotal === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, filteredTotal);

  return (
    <section aria-label={`${noun.many} list`} className="flex flex-col gap-3">
      <nav aria-label="Filter by status" className="flex flex-wrap gap-1.5">
        <Link href={listHref(basePath, params, { status: null })} className={!params.status ? "tab-active" : "tab-inactive"}>
          All ({total.toLocaleString("en-US")})
        </Link>
        {statuses.map((s) => (
          <Link
            key={s}
            href={listHref(basePath, params, { status: s })}
            className={params.status === s ? "tab-active" : "tab-inactive"}
            aria-current={params.status === s ? "page" : undefined}
          >
            {statusLabel(s)} ({(statusCounts[s] ?? 0).toLocaleString("en-US")})
          </Link>
        ))}
      </nav>

      <Form action={basePath} className="flex flex-wrap items-end gap-2" role="search">
        {params.status && <input type="hidden" name="status" value={params.status} />}
        {params.sort !== "created" && <input type="hidden" name="sort" value={params.sort} />}
        <label className="field-label min-w-0 flex-1">
          <span className="sr-only">Search {noun.many}</span>
          <input
            type="search"
            name="q"
            defaultValue={params.q}
            maxLength={100}
            placeholder={`Search name, email or ${locationLabel.toLowerCase()}…`}
            className="input"
          />
        </label>
        <button type="submit" className="btn-secondary">
          Search
        </button>
        {params.q && (
          <Link href={listHref(basePath, params, { q: "" })} className="btn-ghost">
            Clear
          </Link>
        )}
      </Form>

      <p className="text-sm muted" aria-live="polite">
        {filteredTotal === 0
          ? `No ${noun.many} match${params.q ? ` “${params.q}”` : ""}${params.status ? ` in ${statusLabel(params.status)}` : ""}.`
          : `Showing ${from.toLocaleString("en-US")}–${to.toLocaleString("en-US")} of ${filteredTotal.toLocaleString("en-US")} ${
              filteredTotal === 1 ? noun.one : noun.many
            }`}
      </p>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
            <tr>
              <th className="w-10 px-2 py-3">
                <span className="sr-only">Starred</span>
              </th>
              <SortHeader label="Name" sortKey="name" basePath={basePath} params={params} />
              <th className="px-3 py-3">{locationLabel}</th>
              <th className="px-3 py-3">Email</th>
              <th className="px-3 py-3">Phone</th>
              <th className="px-3 py-3">Status</th>
              <SortHeader label="Last emailed" sortKey="emailed" basePath={basePath} params={params} />
              <SortHeader label="Added" sortKey="created" basePath={basePath} params={params} />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center muted">
                  {total === 0 ? `No ${noun.many} yet — run the pipeline or add one by hand.` : `Nothing here.`}
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} className="transition hover:bg-indigo-50/50 dark:hover:bg-indigo-500/[0.06]">
                <td className="px-2 py-1">
                  <StarButton pipeline={pipeline} leadId={row.id} leadName={row.name} starred={row.starred} />
                </td>
                <td className="min-w-[9rem] max-w-[16rem] px-3 py-2">
                  <Link
                    href={`${basePath}/${row.id}`}
                    className="line-clamp-2 break-words font-medium hover:text-indigo-700 dark:hover:text-indigo-300"
                  >
                    {row.name}
                  </Link>
                  {row.subtitle && <div className="truncate text-xs muted">{row.subtitle}</div>}
                </td>
                <td className="whitespace-nowrap px-3 py-2 muted">{row.location}</td>
                <td className="max-w-[14rem] px-3 py-2 muted">
                  <span className="block truncate" title={row.email ?? undefined}>
                    {row.email ?? "—"}
                  </span>
                  {row.flagged && <span className="text-xs text-amber-800 dark:text-amber-300">Won&apos;t be auto-sent</span>}
                </td>
                <td className="whitespace-nowrap px-3 py-2 muted">{row.phone ?? "—"}</td>
                <td className="px-3 py-2">
                  <StatusBadge status={row.status} />
                </td>
                <td className="whitespace-nowrap px-3 py-2 muted">{formatDate(row.lastEmailedAt)}</td>
                <td className="whitespace-nowrap px-3 py-2 muted">{formatDate(row.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-2 text-sm">
          {page > 1 ? (
            <Link href={listHref(basePath, params, { page: page - 1 })} className="btn-secondary" rel="prev">
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="muted">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link href={listHref(basePath, params, { page: page + 1 })} className="btn-secondary" rel="next">
              Next →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </section>
  );
}

function SortHeader({
  label,
  sortKey,
  basePath,
  params,
}: {
  label: string;
  sortKey: SortKey;
  basePath: string;
  params: ListParams;
}) {
  const active = params.sort === sortKey;
  const nextDir = active ? (params.dir === "asc" ? "desc" : "asc") : sortKey === "name" ? "asc" : "desc";
  return (
    <th className="px-3 py-3" aria-sort={active ? (params.dir === "asc" ? "ascending" : "descending") : "none"}>
      <Link
        href={listHref(basePath, params, { sort: sortKey, dir: nextDir })}
        className="inline-flex min-h-11 items-center gap-1 whitespace-nowrap hover:text-zinc-900 sm:min-h-0 dark:hover:text-zinc-100"
      >
        {label}
        <span aria-hidden>{active ? (params.dir === "asc" ? "↑" : "↓") : "↕"}</span>
      </Link>
    </th>
  );
}
