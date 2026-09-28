import type { Metadata } from "next";
import EmailCode from "@/components/EmailCode";
import HowThisWorks from "@/components/HowThisWorks";
import Link from "next/link";
import { prisma } from "@/lib/db";
import OutreachControls from "@/components/OutreachControls";
import ReplyStatus from "@/components/ReplyStatus";
import PipelineAlerts from "@/components/PipelineAlerts";
import { getReplyHealth } from "@/lib/outreach/reply-health";
import VaultScheduleSettings, { type RunView } from "@/components/VaultScheduleSettings";
import LeadTable from "@/components/LeadTable";
import { GARBAGE_AI_SENDER_EMAIL } from "@/lib/garbage-ai-config";
import { GARBAGE_AI_DAILY_RUN_TIME_LABEL, GARBAGE_AI_SCHEDULE_ID, getPipelineSchedule } from "@/lib/pipeline-schedule";
import { getAppSettings } from "@/lib/outreach/settings";
import { displayRunStatus, isRunOverdue, recentRuns } from "@/lib/outreach/runs";
import { GARBAGE_AI_STATUSES } from "@/lib/lead-status";
import { orderByFor, pageCount, PAGE_SIZE, parseListParams, searchWhere } from "@/lib/lead-list";
import { formatDateTime } from "@/lib/time";
import { getPipeline } from "@/lib/outreach/pipelines";
import { peekNextHaulerCity } from "@/lib/garbage-ai-city-picker";
import { countUnsentDailyHaulers } from "@/lib/garbage-ai-daily-run";

export const metadata: Metadata = { title: "Garbage AI — Haulers" };
export const dynamic = "force-dynamic";
export const maxDuration = 60; // Discovery guesses a website and finds an email per hauler.

export default async function GarbageAi({ searchParams }: PageProps<"/garbage-ai">) {
  const params = parseListParams(await searchParams, GARBAGE_AI_STATUSES);
  const where = {
    ...(params.status ? { status: params.status } : {}),
    ...searchWhere(params.q, ["name", "company", "email", "city", "services"]),
  };
  const pipeline = getPipeline("garbage-ai");

  const [filteredTotal, total, counts, schedule, settings, runs, unsent, dailyRunUnsent, blocked, replyHealth, nextCity] =
    await Promise.all([
      prisma.haulerLead.count({ where }),
      prisma.haulerLead.count(),
      prisma.haulerLead.groupBy({ by: ["status"], _count: true }),
      getPipelineSchedule(GARBAGE_AI_SCHEDULE_ID),
      getAppSettings(),
      recentRuns("garbage-ai", "daily", 5),
      pipeline.countSendable(prisma),
      countUnsentDailyHaulers(),
      pipeline.countBlockedNew(prisma),
      getReplyHealth(),
      peekNextHaulerCity(prisma),
    ]);
  const page = Math.min(params.page, pageCount(filteredTotal));
  const leads = await prisma.haulerLead.findMany({
    where,
    orderBy: orderByFor(params),
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });

  const lastRun = runs[0];
  const staleWarning =
    schedule.enabled && lastRun && isRunOverdue(lastRun.startedAt)
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
        <h1 className="accent-text text-2xl font-bold tracking-tight">Garbage AI</h1>
        <p className="mt-1 text-sm muted">
          Finds independent waste haulers and emails each one a demo invite from <EmailCode email={GARBAGE_AI_SENDER_EMAIL} />.
        </p>
        <div className="mt-1">
          <HowThisWorks>
            <p>
              Haulers come from a Yelp search for garbage collection, one new US city a day; an email address is looked for on each
              one&apos;s website, and every address gets one pitch at most (none that Cold Outreach already emailed). Current clients,
              national haulers, city departments and Mountain High Disposal&apos;s service area are left out. Haulers that don&apos;t reply
              within a week move to the call deck. Demo requests go to Max to book.
            </p>
          </HowThisWorks>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/garbage-ai/new" className="btn-secondary">
            + Add hauler by hand
          </Link>
          <a href="#tools" className="btn-ghost">
            Find haulers and daily run ↓
          </a>
        </div>
      </div>

      {pipeline.sendHold && <p className="notice-warning">{pipeline.sendHold}</p>}
      <PipelineAlerts replyHealth={replyHealth} staleWarning={staleWarning} />

      <LeadTable
        pipeline="garbage-ai"
        basePath="/garbage-ai"
        params={{ ...params, page }}
        rows={leads.map((lead) => ({
          id: lead.id,
          name: lead.name,
          subtitle: lead.services,
          location: lead.city ? [lead.city, lead.state].filter(Boolean).join(", ") : "—",
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
        statuses={GARBAGE_AI_STATUSES}
        statusCounts={Object.fromEntries(counts.map((c) => [c.status, c._count]))}
        locationLabel="Location"
        noun={{ one: "hauler", many: "haulers" }}
      />

      <section
        id="tools"
        aria-labelledby="tools-heading"
        className="flex scroll-mt-20 flex-col gap-4 border-t border-zinc-200 pt-6 dark:border-zinc-800"
      >
        <h2 id="tools-heading" className="text-lg font-semibold">
          Find and email haulers
        </h2>
        <OutreachControls
          pipeline="garbage-ai"
          paused={settings.outboundPaused}
          unsent={unsent}
          dailyRunUnsent={dailyRunUnsent}
          blocked={blocked}
          nextCity={`${nextCity.city}, ${nextCity.state}`}
          sendHold={pipeline.sendHold}
        />
        <ReplyStatus health={replyHealth} showUnmatched={false} />
        <VaultScheduleSettings
          haulers
          schedule={schedule}
          runTimeLabel={GARBAGE_AI_DAILY_RUN_TIME_LABEL}
          paused={settings.outboundPaused}
          sendHold={pipeline.sendHold}
          runs={runViews}
          staleWarning={null}
        />
      </section>
    </div>
  );
}
