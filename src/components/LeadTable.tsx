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

type LeadRow = {
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
  /** New, but will never be auto-sent (duplicate or opted-out address). */
  flagged: boolean;
  /** Why the latest send attempt failed or was refused (null once a send succeeds). */
  lastSendFailure: string | null;
  /** A reply arrived while the lead was Lost / Not interested. */
  needsReview: boolean;
};

function RowFlags({ row }: { row: LeadRow }) {
  if (!row.flagged && !row.needsReview && !row.lastSendFailure) return null;
  return (
    <div className="flex flex-wrap gap-x-2 text-xs font-medium">
      {row.needsReview && <span className="text-amber-800 dark:text-amber-300">Reply needs a look</span>}
      {row.lastSendFailure && (
        <span className="text-red-700 dark:text-red-300" title={row.lastSendFailure}>
          Last send failed
        </span>
      )}
      {row.flagged && <span className="text-amber-800 dark:text-amber-300">Won&apos;t be auto-sent</span>}
    </div>
  );
}

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
        {filteredTotal > 0 &&
          `Showing ${from.toLocaleString("en-US")}–${to.toLocaleString("en-US")} of ${filteredTotal.toLocaleString("en-US")} ${
            filteredTotal === 1 ? noun.one : noun.many
          }`}
      </p>

      {rows.length === 0 ? (
        total === 0 ? (
          <div className="card flex flex-col items-center gap-3 px-4 py-10 text-center text-sm">
            <p className="muted">
              No {noun.many} yet — search for some with the tools{" "}
              <a href="#tools" className="underline underline-offset-2">
                below the list
              </a>
              , or add one by hand.
            </p>
            <Link href={`${basePath}/new`} className="btn-secondary">
              Add {noun.one === "agent" ? "an agent" : `a ${noun.one}`}
            </Link>
          </div>
        ) : (
          <div className="card flex flex-col items-center gap-3 px-4 py-10 text-center text-sm">
            <p className="muted">
              No {noun.many} match{params.q ? ` “${params.q}”` : ""}
              {params.status ? ` in ${statusLabel(params.status)}` : ""}.
            </p>
            <Link href={listHref(basePath, params, { q: "", status: null })} className="btn-secondary">
              Clear {params.q && params.status ? "search and filter" : params.q ? "search" : "filter"}
            </Link>
          </div>
        )
      ) : (
        <>
          {/* Phones: one card per lead, with the name, status and last-emailed date always visible. */}
          <ul className="card divide-y divide-zinc-100 md:hidden dark:divide-zinc-800/70">
            {rows.map((row) => (
              <li key={row.id} className="flex items-start gap-1 px-2 py-2">
                <StarButton pipeline={pipeline} leadId={row.id} leadName={row.name} starred={row.starred} />
                <div className="flex min-w-0 flex-1 flex-col gap-1 py-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={`${basePath}/${row.id}`}
                      title={row.name}
                      className="-my-3 line-clamp-2 min-w-0 break-words py-3 font-medium hover:text-indigo-700 dark:hover:text-indigo-300"
                    >
                      {row.name}
                    </Link>
                    <StatusBadge status={row.status} />
                  </div>
                  <RowFlags row={row} />
                  <div className="truncate text-xs muted" title={row.email ?? undefined}>
                    {row.email ?? "No email"}
                    {row.location !== "—" ? ` · ${row.location}` : ""}
                  </div>
                  <div className="text-xs muted">{row.lastEmailedAt ? `Emailed ${formatDate(row.lastEmailedAt)}` : "Not emailed yet"}</div>
                </div>
              </li>
            ))}
          </ul>

          {/* Tablets and up: a fixed-layout table that fits the page width; long values are cut short with the full text on hover. */}
          <div className="card hidden md:block">
            <table className="w-full table-fixed text-sm">
              {/* From lg up the column headers stay in view under the sticky site header while the list scrolls. */}
              <thead className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-600 dark:border-zinc-800 dark:text-zinc-400 lg:[&_th]:sticky lg:[&_th]:top-[var(--site-header-h,57px)] lg:[&_th]:z-[5] lg:[&_th]:bg-white lg:[&_th]:shadow-[inset_0_-1px_0_var(--color-zinc-200)] dark:lg:[&_th]:bg-zinc-900 dark:lg:[&_th]:shadow-[inset_0_-1px_0_var(--color-zinc-800)]">
                <tr>
                  <th className="w-11 px-1 py-3">
                    <span className="sr-only">Starred</span>
                  </th>
                  <SortHeader label="Name" sortKey="name" basePath={basePath} params={params} />
                  <th className="hidden w-[14%] px-3 py-3 lg:table-cell">{locationLabel}</th>
                  <th className="w-[32%] px-3 py-3 lg:w-[24%]">Contact</th>
                  <th className="w-36 px-2 py-3">Status</th>
                  <SortHeader label="Emailed" sortKey="emailed" basePath={basePath} params={params} className="w-32" />
                  <SortHeader label="Added" sortKey="created" basePath={basePath} params={params} className="hidden w-32 lg:table-cell" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
                {rows.map((row) => (
                  <tr key={row.id} className="transition hover:bg-indigo-50/50 dark:hover:bg-indigo-500/[0.06]">
                    <td className="px-1 py-1 align-top">
                      <StarButton pipeline={pipeline} leadId={row.id} leadName={row.name} starred={row.starred} />
                    </td>
                    <td className="px-3 py-2 align-top">
                      <Link
                        href={`${basePath}/${row.id}`}
                        title={row.name}
                        className="line-clamp-2 break-words font-medium hover:text-indigo-700 dark:hover:text-indigo-300"
                      >
                        {row.name}
                      </Link>
                      {row.subtitle && (
                        <div className="truncate text-xs muted" title={row.subtitle}>
                          {row.subtitle}
                        </div>
                      )}
                      <RowFlags row={row} />
                    </td>
                    <td className="hidden px-3 py-2 align-top muted lg:table-cell">
                      <span className="block truncate" title={row.location}>
                        {row.location}
                      </span>
                    </td>
                    <td className="px-3 py-2 align-top muted">
                      <span className="block truncate" title={row.email ?? undefined}>
                        {row.email ?? "—"}
                      </span>
                      {row.phone && <span className="block truncate text-xs">{row.phone}</span>}
                    </td>
                    <td className="px-2 py-2 align-top">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 align-top muted">{formatDate(row.lastEmailedAt)}</td>
                    <td className="hidden whitespace-nowrap px-3 py-2 align-top muted lg:table-cell">{formatDate(row.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

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
  className = "",
}: {
  label: string;
  sortKey: SortKey;
  basePath: string;
  params: ListParams;
  className?: string;
}) {
  const active = params.sort === sortKey;
  const nextDir = active ? (params.dir === "asc" ? "desc" : "asc") : sortKey === "name" ? "asc" : "desc";
  return (
    <th className={`px-3 py-3 ${className}`} aria-sort={active ? (params.dir === "asc" ? "ascending" : "descending") : "none"}>
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
