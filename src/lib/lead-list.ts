// URL state for the lead tables: status tab, search text, sort and page all
// live in the query string, so a filtered view can be bookmarked, shared
// and survives a refresh or the back button.
export const PAGE_SIZE = 50;

const SORT_KEYS = ["created", "name", "emailed"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = "asc" | "desc";

export type ListParams = {
  status: string | null;
  q: string;
  sort: SortKey;
  dir: SortDir;
  page: number;
};

type RawParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export function parseListParams(raw: RawParams, statuses: readonly string[]): ListParams {
  const status = first(raw.status);
  const sort = first(raw.sort) as SortKey;
  const dir = first(raw.dir);
  const page = Number.parseInt(first(raw.page), 10);
  return {
    status: statuses.includes(status) ? status : null,
    q: first(raw.q).trim().slice(0, 100),
    sort: SORT_KEYS.includes(sort) ? sort : "created",
    dir: dir === "asc" || dir === "desc" ? dir : sort === "name" ? "asc" : "desc",
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

/** A link to the same list with some params changed (page resets unless given). */
export function listHref(basePath: string, params: ListParams, change: Partial<ListParams>): string {
  const next = { ...params, page: 1, ...change };
  const search = new URLSearchParams();
  if (next.status) search.set("status", next.status);
  if (next.q) search.set("q", next.q);
  if (next.sort !== "created") search.set("sort", next.sort);
  const defaultDir = next.sort === "name" ? "asc" : "desc";
  if (next.dir !== defaultDir) search.set("dir", next.dir);
  if (next.page > 1) search.set("page", String(next.page));
  const qs = search.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

/** Prisma orderBy for the params; ties broken by id so paging is stable. */
export function orderByFor(params: ListParams) {
  const field = params.sort === "name" ? "name" : params.sort === "emailed" ? "lastEmailedAt" : "createdAt";
  const primary = field === "lastEmailedAt" ? { lastEmailedAt: { sort: params.dir, nulls: "last" as const } } : { [field]: params.dir };
  return [primary, { id: "asc" as const }];
}

/** Case-insensitive "contains" over the given text columns. */
export function searchWhere(q: string, fields: string[]) {
  if (!q) return {};
  return { OR: fields.map((f) => ({ [f]: { contains: q, mode: "insensitive" as const } })) };
}

export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}
