import Link from "next/link";
import { prisma } from "@/lib/db";
import DataleadsellControls from "@/components/DataleadsellControls";
import StarButton from "@/components/StarButton";
import { DATALEADSELL_SENDER_EMAIL } from "@/lib/dataleadsell-config";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Importing Maricopa licensees downloads ADRE's ~50MB roster.

const STATUSES = [
  "new",
  "contacted",
  "responded",
  "subscribed",
  "not_interested",
  "cold_call_list",
  "contactless_list",
  "lost",
] as const;

const STATUS_LABEL: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  responded: "Responded",
  subscribed: "Subscribed",
  not_interested: "Not interested",
  cold_call_list: "Cold Call List",
  contactless_list: "Contactless List",
  lost: "Lost",
};

const STATUS_COLOR: Record<string, string> = {
  new: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  contacted: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
  responded: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  subscribed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
  not_interested: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500",
  cold_call_list: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400",
  contactless_list: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500",
  lost: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
};

const STATUS_DOT: Record<string, string> = {
  new: "bg-zinc-400",
  contacted: "bg-blue-500",
  responded: "bg-amber-500",
  subscribed: "bg-emerald-500",
  not_interested: "bg-zinc-400",
  cold_call_list: "bg-orange-500",
  contactless_list: "bg-zinc-400",
  lost: "bg-red-500",
};

export default async function DataleadsellPipeline({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const activeStatus = status && STATUSES.includes(status as (typeof STATUSES)[number]) ? status : undefined;

  const [leads, total, withEmail, counts] = await Promise.all([
    prisma.agentLead.findMany({
      where: activeStatus ? { status: activeStatus } : undefined,
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.agentLead.count(),
    prisma.agentLead.count({ where: { email: { not: null } } }),
    prisma.agentLead.groupBy({ by: ["status"], _count: true }),
  ]);
  const countByStatus = Object.fromEntries(counts.map((c) => [c.status, c._count]));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="accent-text text-2xl font-bold tracking-tight">dataleadsell.com</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Finds real estate agents in Maricopa, Salt Lake, and Utah counties (via Yelp) and pitches them a
            Probate Property Leads subscription. Outreach sends from{" "}
            <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs dark:bg-zinc-800">
              {DATALEADSELL_SENDER_EMAIL}
            </code>{" "}
            via ZeptoMail — runs from Vercel, no local machine needed.
          </p>
        </div>
        <Link href="/dataleadsell/stats" className="btn-secondary shrink-0">
          Data Central →
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-2">
        <Stat label="Total agents" value={total} />
        <Stat label="With email" value={withEmail} />
      </div>

      <div className="flex items-center justify-between">
        <DataleadsellControls />
      </div>
      <div className="-mt-4">
        <Link href="/dataleadsell/new" className="text-sm font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400">
          + Add agent manually
        </Link>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <StatusTab label={`All (${total})`} href="/dataleadsell" active={!activeStatus} />
        {STATUSES.map((s) => (
          <StatusTab
            key={s}
            label={`${STATUS_LABEL[s]} (${countByStatus[s] ?? 0})`}
            href={`/dataleadsell?status=${s}`}
            active={activeStatus === s}
          />
        ))}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            <tr>
              <th className="px-4 py-3"></th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">County</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Last emailed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
            {leads.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-zinc-500">
                  No agents here yet.
                </td>
              </tr>
            )}
            {leads.map((lead) => (
              <tr key={lead.id} className="transition hover:bg-indigo-50/50 dark:hover:bg-indigo-500/[0.06]">
                <td className="px-4 py-2.5">
                  <StarButton leadId={lead.id} starred={lead.starred} />
                </td>
                <td className="px-4 py-2.5">
                  <Link href={`/dataleadsell/${lead.id}`} className="font-medium hover:text-indigo-600 dark:hover:text-indigo-400">
                    {lead.name}
                  </Link>
                  {lead.brokerage && <div className="text-xs text-zinc-500">{lead.brokerage}</div>}
                </td>
                <td className="px-4 py-2.5 text-zinc-600 dark:text-zinc-400">
                  {lead.county ? `${lead.county}, ${lead.state}` : "—"}
                </td>
                <td className="px-4 py-2.5 text-zinc-600 dark:text-zinc-400">{lead.email ?? "—"}</td>
                <td className="px-4 py-2.5 text-zinc-600 dark:text-zinc-400">{lead.phone ?? "—"}</td>
                <td className="px-4 py-2.5">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[lead.status]}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[lead.status] ?? "bg-zinc-400"}`} />
                    {STATUS_LABEL[lead.status] ?? lead.status}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-zinc-600 dark:text-zinc-400">
                  {lead.lastEmailedAt ? lead.lastEmailedAt.toLocaleDateString() : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="card p-4">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs text-zinc-500">{label}</div>
    </div>
  );
}

function StatusTab({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link href={href} className={active ? "tab-active" : "tab-inactive"}>
      {label}
    </Link>
  );
}
