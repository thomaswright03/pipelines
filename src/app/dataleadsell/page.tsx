import type { Metadata } from "next";
import EmailCode from "@/components/EmailCode";
import HowThisWorks from "@/components/HowThisWorks";
import Link from "next/link";
import { prisma } from "@/lib/db";
import OutreachControls from "@/components/OutreachControls";
import { peekNextAgentCity } from "@/lib/agent-city-picker";
import ReplyStatus from "@/components/ReplyStatus";
import PipelineAlerts from "@/components/PipelineAlerts";
import { getReplyHealth } from "@/lib/outreach/reply-health";
import AdreImportPanel from "@/components/AdreImportPanel";
import DailyRunSettings from "@/components/DailyRunSettings";
import LeadTable from "@/components/LeadTable";
import { DATALEADSELL_SENDER_EMAIL } from "@/lib/dataleadsell-config";
import { getAppSettings } from "@/lib/outreach/settings";
import { DATALEADSELL_DAILY_RUN_TIME_LABEL, DATALEADSELL_SCHEDULE_ID, getPipelineSchedule } from "@/lib/pipeline-schedule";
import { updateDataleadsellScheduleAction } from "@/lib/actions/pipeline-schedule";
import { recentRuns } from "@/lib/outreach/runs";
import { staleRunWarning, toRunViews } from "@/lib/outreach/run-view";
import { countUnsentDailyAgentLeads } from "@/lib/dataleadsell-daily-run";
import { getPipeline } from "@/lib/outreach/pipelines";
import { getAdreStatus } from "@/lib/adre-import";
import { DATALEADSELL_STATUSES } from "@/lib/lead-status";
import { orderByFor, pageCount, PAGE_SIZE, parseListParams, searchWhere } from "@/lib/lead-list";
import { formatDate } from "@/lib/time";
import { countReadyToEmail } from "@/lib/outreach/send";

export const metadata: Metadata = { title: "dataleadsell — Agents" };
export const dynamic = "force-dynamic";
// Discovery guesses a website and finds an email per agent; loading the
// ADRE roster downloads a large CSV. Each call is budgeted to finish well
// inside this limit.
export const maxDuration = 60;

export default async function DataleadsellPipeline({ searchParams }: PageProps<"/dataleadsell">) {
  const params = parseListParams(await searchParams, DATALEADSELL_STATUSES);
  const where = {
    ...(params.status ? { status: params.status } : {}),
    ...searchWhere(params.q, ["name", "brokerage", "email", "city", "county"]),
  };

  const [filteredTotal, total, withEmail, counts, schedule, settings, runs, adre, ready, dailyRunUnsent, blocked, replyHealth, nextCity] =
    await Promise.all([
      prisma.agentLead.count({ where }),
      prisma.agentLead.count(),
      prisma.agentLead.count({ where: { email: { not: null } } }),
      prisma.agentLead.groupBy({ by: ["status"], _count: true }),
      getPipelineSchedule(DATALEADSELL_SCHEDULE_ID),
      getAppSettings(),
      recentRuns("dataleadsell", "daily", 5),
      getAdreStatus(),
      countReadyToEmail("dataleadsell"),
      countUnsentDailyAgentLeads(),
      getPipeline("dataleadsell").countBlockedNew(prisma),
      getReplyHealth(),
      peekNextAgentCity(prisma),
    ]);
  const page = Math.min(params.page, pageCount(filteredTotal));
  const leads = await prisma.agentLead.findMany({
    where,
    orderBy: orderByFor(params),
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });
  const staleWarning = staleRunWarning(schedule, settings.outboundPaused, runs[0]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="accent-text text-2xl font-bold tracking-tight">dataleadsell.com</h1>
        <p className="mt-1 text-sm muted">
          Finds real estate agents and emails each one a Probate Property Leads pitch from <EmailCode email={DATALEADSELL_SENDER_EMAIL} />.
        </p>
        <div className="mt-1">
          <HowThisWorks>
            <p>
              Agents come from Yelp in Maricopa, Salt Lake and Utah counties, plus Arizona&apos;s ADRE license roster for Maricopa. An email
              address is looked for on each agent&apos;s website, and every address gets one pitch at most. Agents who don&apos;t reply
              within a week move to the call deck.
            </p>
          </HowThisWorks>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/dataleadsell/new" className="btn-secondary">
            + Add agent by hand
          </Link>
          <a href="#tools" className="btn-ghost">
            Find, bulk send, daily run and ADRE import ↓
          </a>
        </div>
      </div>

      <PipelineAlerts replyHealth={replyHealth} staleWarning={staleWarning} />

      <LeadTable
        pipeline="dataleadsell"
        basePath="/dataleadsell"
        params={{ ...params, page }}
        rows={leads.map((lead) => ({
          id: lead.id,
          name: lead.name,
          subtitle: lead.brokerage,
          location: [lead.city, lead.county ? `${lead.county} County` : null].filter(Boolean).join(", ") || "—",
          email: lead.email,
          phone: lead.phone,
          status: lead.status,
          lastEmailedAt: lead.lastEmailedAt,
          createdAt: lead.createdAt,
          starred: lead.starred,
          flagged: lead.status === "new" && lead.sendBlockedReason !== null,
          lastSendFailure: lead.lastSendFailedAt ? lead.lastSendFailure : null,
          needsReview: lead.replyNeedsReview,
        }))}
        filteredTotal={filteredTotal}
        total={total}
        statuses={DATALEADSELL_STATUSES}
        statusCounts={Object.fromEntries(counts.map((c) => [c.status, c._count]))}
        locationLabel="City / county"
        noun={{ one: "agent", many: "agents" }}
      />

      <section
        id="tools"
        aria-labelledby="tools-heading"
        className="flex scroll-mt-20 flex-col gap-4 border-t border-zinc-200 pt-6 dark:border-zinc-800"
      >
        <h2 id="tools-heading" className="text-lg font-semibold">
          Find and email agents
        </h2>
        <div className="grid grid-cols-2 gap-4">
          <Stat label="Total agents" value={total} />
          <Stat label="With email" value={withEmail} />
        </div>
        <OutreachControls
          pipeline="dataleadsell"
          paused={settings.outboundPaused}
          unsent={ready.readyToEmail}
          willSkip={ready.newWithAddress - ready.readyToEmail}
          // While the daily run is off, nothing is emailed without Send outreach.
          dailyRunUnsent={schedule.enabled ? dailyRunUnsent : null}
          blocked={blocked}
          nextCity={`${nextCity.city} (${nextCity.county} County, ${nextCity.state})`}
        />
        <ReplyStatus health={replyHealth} showUnmatched={false} />
        {/* A stale-run warning is shown above the list (PipelineAlerts). */}
        <DailyRunSettings
          pipeline="dataleadsell"
          action={updateDataleadsellScheduleAction}
          schedule={schedule}
          runTimeLabel={DATALEADSELL_DAILY_RUN_TIME_LABEL}
          paused={settings.outboundPaused}
          runs={toRunViews(runs)}
          staleWarning={null}
        />
        <AdreImportPanel initial={{ ...adre, loadedAtLabel: adre.loadedAt ? formatDate(adre.loadedAt) : null }} />
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="card p-4">
      <div className="text-2xl font-semibold">{value.toLocaleString("en-US")}</div>
      <div className="text-sm muted">{label}</div>
    </div>
  );
}
