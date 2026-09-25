import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import OutreachControls from "@/components/OutreachControls";
import ReplyStatus from "@/components/ReplyStatus";
import { getReplyHealth } from "@/lib/outreach/reply-health";
import VaultScheduleSettings, { type RunView } from "@/components/VaultScheduleSettings";
import LeadTable from "@/components/LeadTable";
import { VAULT_PIPELINE_SENDER_EMAIL } from "@/lib/vault-config";
import { getPipelineSchedule, VAULT_DAILY_RUN_TIME_LABEL, VAULT_SCHEDULE_ID } from "@/lib/pipeline-schedule";
import { getAppSettings } from "@/lib/outreach/settings";
import { displayRunStatus, isRunOverdue, recentRuns } from "@/lib/outreach/runs";
import { COLD_OUTREACH_STATUSES } from "@/lib/lead-status";
import { orderByFor, pageCount, PAGE_SIZE, parseListParams, searchWhere } from "@/lib/lead-list";
import { formatDateTime } from "@/lib/time";
import { getPipeline } from "@/lib/outreach/pipelines";

export const metadata: Metadata = { title: "Cold Outreach — Leads" };
export const dynamic = "force-dynamic";
export const maxDuration = 60; // Discovery guesses a website and finds an email per business.

export default async function VaultPipeline({ searchParams }: PageProps<"/vault-pipeline">) {
  const params = parseListParams(await searchParams, COLD_OUTREACH_STATUSES);
  const where = {
    ...(params.status ? { status: params.status } : {}),
    ...searchWhere(params.q, ["name", "company", "email", "city"]),
  };

  const [filteredTotal, total, counts, schedule, settings, runs, unsent, blocked, replyHealth] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.count(),
    prisma.lead.groupBy({ by: ["status"], _count: true }),
    getPipelineSchedule(VAULT_SCHEDULE_ID),
    getAppSettings(),
    recentRuns("cold-outreach", "daily", 5),
    getPipeline("cold-outreach").countSendable(prisma),
    getPipeline("cold-outreach").countBlockedNew(prisma),
    getReplyHealth(),
  ]);
  const page = Math.min(params.page, pageCount(filteredTotal));
  const leads = await prisma.lead.findMany({
    where,
    orderBy: orderByFor(params),
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });

  const lastRun = runs[0];
  const staleWarning =
    schedule.enabled && !settings.outboundPaused && lastRun && isRunOverdue(lastRun.startedAt)
      ? `The last daily run was ${formatDateTime(lastRun.startedAt)} — more than a day ago. The automatic schedule may have stopped — ask your developer to check it.`
      : null;
  const runViews: RunView[] = runs.map((r) => ({
    id: r.id,
    status: displayRunStatus(r),
    startedAt: formatDateTime(r.startedAt),
    summary: r.summary ?? (displayRunStatus(r) === "interrupted" ? "The run was cut off before it could record what it did." : null),
    errors: r.errors ? r.errors.split("\n").filter(Boolean) : [],
    numbers:
      r.businessesChecked !== null && r.leadsFound !== null && r.emailsSent !== null
        ? { businessesChecked: r.businessesChecked, leadsFound: r.leadsFound, emailsSent: r.emailsSent }
        : null,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="accent-text text-2xl font-bold tracking-tight">Cold Outreach</h1>
        <p className="mt-1 text-sm muted">
          Wright AI Solutions&apos; own client-acquisition pipeline. Finds local businesses via Yelp, finds an email for each, and
          sends one pitch from{" "}
          <code className="break-all rounded bg-zinc-100 px-1 py-0.5 text-xs dark:bg-zinc-800">{VAULT_PIPELINE_SENDER_EMAIL}</code>.
          Leads that don&apos;t reply within a week move to the call deck.
        </p>
      </div>

      <OutreachControls pipeline="cold-outreach" paused={settings.outboundPaused} unsent={unsent} blocked={blocked} />
      <ReplyStatus health={replyHealth} />
      <VaultScheduleSettings
        schedule={schedule}
        runTimeLabel={VAULT_DAILY_RUN_TIME_LABEL}
        paused={settings.outboundPaused}
        runs={runViews}
        staleWarning={staleWarning}
      />

      <div>
        <Link href="/vault-pipeline/new" className="btn-secondary">
          + Add lead by hand
        </Link>
      </div>

      <LeadTable
        pipeline="cold-outreach"
        basePath="/vault-pipeline"
        params={{ ...params, page }}
        rows={leads.map((lead) => ({
          id: lead.id,
          name: lead.name,
          subtitle: lead.company,
          location: lead.city ? [lead.city, lead.state].filter(Boolean).join(", ") : "—",
          email: lead.email,
          phone: lead.phone,
          status: lead.status,
          lastEmailedAt: lead.lastEmailedAt,
          createdAt: lead.createdAt,
          starred: lead.starred,
          flagged: lead.status === "new" && lead.sendBlockedReason !== null,
          needsReview: lead.replyNeedsReview,
        }))}
        filteredTotal={filteredTotal}
        total={total}
        statuses={COLD_OUTREACH_STATUSES}
        statusCounts={Object.fromEntries(counts.map((c) => [c.status, c._count]))}
        locationLabel="Location"
        noun={{ one: "lead", many: "leads" }}
      />
    </div>
  );
}
