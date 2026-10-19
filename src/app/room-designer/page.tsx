import type { Metadata } from "next";
import EmailCode from "@/components/EmailCode";
import HowThisWorks from "@/components/HowThisWorks";
import Link from "next/link";
import { prisma } from "@/lib/db";
import OutreachControls from "@/components/OutreachControls";
import ReplyStatus from "@/components/ReplyStatus";
import PipelineAlerts from "@/components/PipelineAlerts";
import { getReplyHealth } from "@/lib/outreach/reply-health";
import DailyRunSettings from "@/components/DailyRunSettings";
import { updateRoomDesignerScheduleAction } from "@/lib/actions/pipeline-schedule";
import LeadTable from "@/components/LeadTable";
import PipelineTotals from "@/components/PipelineTotals";
import { ROOM_DESIGNER_SENDER_EMAIL, ROOM_DESIGNER_SIGNUP_URL } from "@/lib/room-designer-config";
import { ROOM_DESIGNER_DAILY_RUN_TIME_LABEL, ROOM_DESIGNER_SCHEDULE_ID, getPipelineSchedule } from "@/lib/pipeline-schedule";
import { getAppSettings } from "@/lib/outreach/settings";
import { recentRuns } from "@/lib/outreach/runs";
import { staleRunWarning, toRunViews } from "@/lib/outreach/run-view";
import { ROOM_DESIGNER_STATUSES } from "@/lib/lead-status";
import { orderByFor, pageCount, PAGE_SIZE, parseListParams, searchWhere } from "@/lib/lead-list";
import { getPipeline } from "@/lib/outreach/pipelines";
import { peekNextRemodelerCity } from "@/lib/room-designer-city-picker";
import { countUnsentDailyRemodelers } from "@/lib/room-designer-daily-run";
import { countReadyToEmail } from "@/lib/outreach/send";

export const metadata: Metadata = { title: "Room Designer 3D — Remodelers" };
export const dynamic = "force-dynamic";
export const maxDuration = 60; // Discovery guesses a website and finds an email per remodeler.

export default async function RoomDesigner({ searchParams }: PageProps<"/room-designer">) {
  const params = parseListParams(await searchParams, ROOM_DESIGNER_STATUSES);
  const where = {
    ...(params.status ? { status: params.status } : {}),
    ...searchWhere(params.q, ["name", "company", "email", "city", "services"]),
  };
  const pipeline = getPipeline("room-designer");

  const [filteredTotal, total, withEmail, counts, schedule, settings, runs, ready, dailyRunUnsent, blocked, replyHealth, nextCity] =
    await Promise.all([
      prisma.remodelerLead.count({ where }),
      prisma.remodelerLead.count(),
      prisma.remodelerLead.count({ where: { email: { not: null } } }),
      prisma.remodelerLead.groupBy({ by: ["status"], _count: true }),
      getPipelineSchedule(ROOM_DESIGNER_SCHEDULE_ID),
      getAppSettings(),
      recentRuns("room-designer", "daily", 5),
      countReadyToEmail("room-designer"),
      countUnsentDailyRemodelers(),
      pipeline.countBlockedNew(prisma),
      getReplyHealth(),
      peekNextRemodelerCity(prisma),
    ]);
  const page = Math.min(params.page, pageCount(filteredTotal));
  const leads = await prisma.remodelerLead.findMany({
    where,
    orderBy: orderByFor(params),
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });

  // A pause stops the daily run outright (no search either), as for every pipeline.
  const runPaused = settings.outboundPaused;
  const staleWarning = staleRunWarning(schedule, runPaused, runs[0]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="accent-text text-2xl font-bold tracking-tight">Room Designer 3D</h1>
        <p className="mt-1 text-sm muted">
          Finds independent bathroom remodelers and emails each one Thomas&apos;s Room Designer 3D pitch from{" "}
          <EmailCode email={ROOM_DESIGNER_SENDER_EMAIL} />.
        </p>
        <div className="mt-1">
          <HowThisWorks>
            <p>
              Remodelers come from a Yelp search for bathroom remodeling, one new US city at a time, each weekday at 9:00 AM Arizona time;
              an email address is looked for on each one&apos;s website, and every address gets one pitch at most (none another pipeline
              already emailed). National franchises, big-box installers, plumbing-only listings, supply houses and showrooms, and Eddys
              Remodeling are left out. Remodelers that don&apos;t reply within a week move to the call deck. Offer a 15-minute walkthrough,
              then the free-week sign-up: <a href={ROOM_DESIGNER_SIGNUP_URL}>{ROOM_DESIGNER_SIGNUP_URL}</a>.
            </p>
          </HowThisWorks>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/room-designer/new" className="btn-secondary">
            + Add remodeler by hand
          </Link>
          <a href="#tools" className="btn-ghost">
            Find remodelers and daily run ↓
          </a>
        </div>
      </div>

      {pipeline.sendHold && <p className="notice-warning">{pipeline.sendHold}</p>}
      <PipelineAlerts replyHealth={replyHealth} staleWarning={staleWarning} />

      <LeadTable
        pipeline="room-designer"
        basePath="/room-designer"
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
          neverPitch: lead.status === "new" ? pipeline.neverPitch(lead) : null,
        }))}
        filteredTotal={filteredTotal}
        total={total}
        statuses={ROOM_DESIGNER_STATUSES}
        statusCounts={Object.fromEntries(counts.map((c) => [c.status, c._count]))}
        locationLabel="Location"
        noun={{ one: "remodeler", many: "remodelers" }}
      />

      <section
        id="tools"
        aria-labelledby="tools-heading"
        className="flex scroll-mt-20 flex-col gap-4 border-t border-zinc-200 pt-6 dark:border-zinc-800"
      >
        <h2 id="tools-heading" className="text-lg font-semibold">
          Find and email remodelers
        </h2>
        <PipelineTotals pipeline="room-designer" total={total} withEmail={withEmail} />
        <OutreachControls
          pipeline="room-designer"
          paused={settings.outboundPaused}
          unsent={ready.readyToEmail}
          willSkip={ready.newWithAddress - ready.readyToEmail}
          dailyRunUnsent={dailyRunUnsent}
          blocked={blocked}
          nextCity={`${nextCity.city}, ${nextCity.state}`}
          sendHold={pipeline.sendHold}
        />
        <ReplyStatus health={replyHealth} showUnmatched={false} />
        <DailyRunSettings
          pipeline="room-designer"
          action={updateRoomDesignerScheduleAction}
          schedule={schedule}
          runTimeLabel={ROOM_DESIGNER_DAILY_RUN_TIME_LABEL}
          paused={runPaused}
          runs={toRunViews(runs)}
          staleWarning={null}
        />
      </section>
    </div>
  );
}
