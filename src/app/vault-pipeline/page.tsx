import Link from "next/link";
import { prisma } from "@/lib/db";
import VaultControls from "@/components/VaultControls";
import VaultStarButton from "@/components/VaultStarButton";
import VaultScheduleSettings from "@/components/VaultScheduleSettings";
import { VAULT_PIPELINE_SENDER_EMAIL } from "@/lib/vault-config";
import { getPipelineSchedule } from "@/lib/actions/pipeline-schedule";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Discovery now guesses a website + finds an email per business.

const STATUSES = [
  "new",
  "contacted",
  "responded",
  "appointment_set",
  "working_for",
  "paying_client",
  "cold_call_list",
  "contactless_list",
  "lost",
] as const;

const STATUS_LABEL: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  responded: "Responded",
  appointment_set: "Appointment Set",
  working_for: "Working For",
  paying_client: "Paying Client",
  cold_call_list: "Cold Call List",
  contactless_list: "Contactless List",
  lost: "Lost",
};

const STATUS_COLOR: Record<string, string> = {
  new: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  contacted: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
  responded: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  appointment_set: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400",
  working_for: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-400",
  paying_client: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
  cold_call_list: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400",
  contactless_list: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500",
  lost: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
};

const STATUS_DOT: Record<string, string> = {
  new: "bg-zinc-400",
  contacted: "bg-blue-500",
  responded: "bg-amber-500",
  appointment_set: "bg-purple-500",
  working_for: "bg-cyan-500",
  paying_client: "bg-emerald-500",
  cold_call_list: "bg-orange-500",
  contactless_list: "bg-zinc-400",
  lost: "bg-red-500",
};

export default async function VaultPipeline({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const activeStatus = status && STATUSES.includes(status as (typeof STATUSES)[number]) ? status : undefined;

  const [leads, total, counts, schedule] = await Promise.all([
    prisma.lead.findMany({
      where: activeStatus ? { status: activeStatus } : undefined,
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.lead.count(),
    prisma.lead.groupBy({ by: ["status"], _count: true }),
    getPipelineSchedule("vault-pipeline"),
  ]);
  const countByStatus = Object.fromEntries(counts.map((c) => [c.status, c._count]));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="accent-text text-2xl font-bold tracking-tight">Cold Outreach</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Wright AI Solutions&apos; own client-acquisition pipeline — copied in full from The Vault so it
            runs standalone here. Finds businesses via Yelp, outreach sends from{" "}
            <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs dark:bg-zinc-800">
              {VAULT_PIPELINE_SENDER_EMAIL}
            </code>{" "}
            via ZeptoMail — runs from Vercel, no local machine needed.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Link href="/vault-pipeline/stats" className="btn-secondary">
            Data Central →
          </Link>
          <Link href="/vault-pipeline/cold-call" className="btn-secondary">
            Cold call deck →
          </Link>
        </div>
      </div>

      <VaultControls />
      <VaultScheduleSettings schedule={schedule} />

      <div className="-mt-2">
        <Link href="/vault-pipeline/new" className="text-sm font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400">
          + Add lead manually
        </Link>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <StatusTab label={`All (${total})`} href="/vault-pipeline" active={!activeStatus} />
        {STATUSES.map((s) => (
          <StatusTab
            key={s}
            label={`${STATUS_LABEL[s]} (${countByStatus[s] ?? 0})`}
            href={`/vault-pipeline?status=${s}`}
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
              <th className="px-4 py-3">Location</th>
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
                  No leads here yet.
                </td>
              </tr>
            )}
            {leads.map((lead) => (
              <tr key={lead.id} className="transition hover:bg-indigo-50/50 dark:hover:bg-indigo-500/[0.06]">
                <td className="px-4 py-2.5">
                  <VaultStarButton leadId={lead.id} starred={lead.starred} />
                </td>
                <td className="px-4 py-2.5">
                  <Link href={`/vault-pipeline/${lead.id}`} className="font-medium hover:text-indigo-600 dark:hover:text-indigo-400">
                    {lead.name}
                  </Link>
                  {lead.company && <div className="text-xs text-zinc-500">{lead.company}</div>}
                </td>
                <td className="px-4 py-2.5 text-zinc-600 dark:text-zinc-400">
                  {lead.city ? `${lead.city}, ${lead.state}` : "—"}
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

function StatusTab({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link href={href} className={active ? "tab-active" : "tab-inactive"}>
      {label}
    </Link>
  );
}
