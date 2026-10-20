// The daily report email (/api/cron/daily-report, 10:00 AM Arizona time):
// one plain-text email to the owner with a section per outreach pipeline,
// covering the last 24 hours — whether its daily run happened and how it
// ended, what it found and sent, sends that failed or bounced, replies and
// opt-outs, leads moved to the call deck, and anything that went wrong.
//
// Every pipeline in PIPELINE_IDS gets a section: REPORT_SOURCES below is keyed
// by PipelineId, so adding a pipeline without saying where its data lives is
// a compile error rather than a pipeline silently missing from the report.
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  DATALEADSELL_DAILY_RUN_TIME_LABEL,
  DATALEADSELL_SCHEDULE_ID,
  GARBAGE_AI_DAILY_RUN_TIME_LABEL,
  GARBAGE_AI_SCHEDULE_ID,
  getPipelineSchedule,
  ROOM_DESIGNER_DAILY_RUN_TIME_LABEL,
  ROOM_DESIGNER_SCHEDULE_ID,
  VAULT_DAILY_RUN_TIME_LABEL,
  VAULT_SCHEDULE_ID,
} from "@/lib/pipeline-schedule";
import { ROOM_DESIGNER_RUNS_WEEKDAYS_ONLY, VAULT_RUNS_WEEKDAYS_ONLY } from "@/lib/pipeline-schedule-rules";
import { VAULT_PIPELINE_SENDER_EMAIL } from "@/lib/vault-config";
import { getPipeline } from "@/lib/outreach/pipelines";
import { PIPELINE_IDS, PIPELINE_LABEL, type PipelineId } from "@/lib/outreach/pipeline-id";
import { displayRunStatus } from "@/lib/outreach/runs";
import { getAppSettings } from "@/lib/outreach/settings";
import { dayKey, formatDate, formatDateTime } from "@/lib/time";

/** Who gets the report, and who it comes from (a sender verified in ZeptoMail). */
export const DAILY_REPORT_TO = process.env.DAILY_REPORT_TO || "t@thomasewright.com";
export const DAILY_REPORT_FROM = process.env.DAILY_REPORT_FROM || VAULT_PIPELINE_SENDER_EMAIL;
/**
 * The link to the app at the bottom of the report: DAILY_REPORT_APP_URL,
 * else this Vercel project's production domain (VERCEL_PROJECT_PRODUCTION_URL,
 * which Vercel sets itself), else none — so a second deployment never links
 * to another one's app.
 */
export function reportAppUrl(env: Record<string, string | undefined> = process.env): string | null {
  const configured = env.DAILY_REPORT_APP_URL?.trim();
  if (configured) return configured;
  const production = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return production ? `https://${production}` : null;
}

const WINDOW_MS = 24 * 60 * 60 * 1000;

type ReportSource = {
  scheduleId: string;
  runTime: string;
  /** Runs Monday to Friday only: a weekend day without a run is normal. */
  weekdaysOnly?: boolean;
  /** Table names for the counts done in SQL (fixed strings, never user input). */
  leadTable: string;
  logTable: string;
  activityTable: string;
};

const REPORT_SOURCES: Record<PipelineId, ReportSource> = {
  "cold-outreach": {
    scheduleId: VAULT_SCHEDULE_ID,
    runTime: VAULT_DAILY_RUN_TIME_LABEL,
    weekdaysOnly: VAULT_RUNS_WEEKDAYS_ONLY,
    leadTable: "Lead",
    logTable: "LeadEmailSendLog",
    activityTable: "LeadActivity",
  },
  "garbage-ai": {
    scheduleId: GARBAGE_AI_SCHEDULE_ID,
    runTime: GARBAGE_AI_DAILY_RUN_TIME_LABEL,
    leadTable: "HaulerLead",
    logTable: "HaulerEmailSendLog",
    activityTable: "HaulerLeadActivity",
  },
  "room-designer": {
    scheduleId: ROOM_DESIGNER_SCHEDULE_ID,
    runTime: ROOM_DESIGNER_DAILY_RUN_TIME_LABEL,
    weekdaysOnly: ROOM_DESIGNER_RUNS_WEEKDAYS_ONLY,
    leadTable: "RemodelerLead",
    logTable: "RemodelerEmailSendLog",
    activityTable: "RemodelerLeadActivity",
  },
  dataleadsell: {
    scheduleId: DATALEADSELL_SCHEDULE_ID,
    runTime: DATALEADSELL_DAILY_RUN_TIME_LABEL,
    leadTable: "AgentLead",
    logTable: "EmailSendLog",
    activityTable: "AgentLeadActivity",
  },
};

/** The History entry the stale-contacts move writes (outreach/pipelines.ts STALE_NOTE). */
const CALL_DECK_NOTE_PREFIX = "Moved to the call deck";

type RunLine = { status: string; startedAt: Date; summary: string | null; errors: string[]; hitTimeLimit: boolean };

type PipelineSection = {
  id: PipelineId;
  label: string;
  enabled: boolean;
  runTime: string;
  runs: RunLine[];
  businessesChecked: number;
  newLeads: number;
  sent: number;
  failed: number;
  bounced: number;
  replies: number;
  repliesNeedingLook: number;
  optOuts: number;
  autoReplies: number;
  movedToCallDeck: number;
  readyToSend: number;
  heldBack: number;
  /** Things worth the owner's attention, in plain words. */
  problems: string[];
};

export type DailyReport = {
  since: Date;
  now: Date;
  outboundPaused: boolean;
  unmatchedReplies: number;
  staleContactsProblem: string | null;
  sections: PipelineSection[];
};

// Timestamps are stored as UTC wall-clock times without a zone.
const utc = (d: Date) => Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
const table = (name: string) => Prisma.raw(`"${name}"`);

async function countRows(tableName: string, column: string, since: Date, extra: Prisma.Sql = Prisma.empty): Promise<number> {
  const [row] = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n FROM ${table(tableName)}
    WHERE ${Prisma.raw(`"${column}"`)} >= ${utc(since)} ${extra}`;
  return Number(row?.n ?? 0);
}

async function countReplies(pipeline: PipelineId, since: Date) {
  const prefix = `${pipeline}:`;
  const [row] = await prisma.$queryRaw<{ replies: bigint; needs_look: bigint; opt_outs: bigint; auto: bigint }[]>`
    SELECT COUNT(*) FILTER (WHERE "kind" = 'reply' AND NOT "optedOut")::bigint AS replies,
           COUNT(*) FILTER (WHERE "kind" = 'reply' AND "reviewReason" IS NOT NULL AND "resolvedAt" IS NULL)::bigint AS needs_look,
           COUNT(*) FILTER (WHERE "optedOut")::bigint AS opt_outs,
           COUNT(*) FILTER (WHERE "kind" = 'auto_reply')::bigint AS auto
    FROM "InboundReply"
    WHERE "receivedAt" >= ${utc(since)}
      AND EXISTS (SELECT 1 FROM unnest("matched") m WHERE left(m, ${prefix.length}) = ${prefix})`;
  return {
    replies: Number(row?.replies ?? 0),
    repliesNeedingLook: Number(row?.needs_look ?? 0),
    optOuts: Number(row?.opt_outs ?? 0),
    autoReplies: Number(row?.auto ?? 0),
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

async function buildSection(id: PipelineId, since: Date, now: Date, outboundPaused: boolean): Promise<PipelineSection> {
  const source = REPORT_SOURCES[id];
  const adapter = getPipeline(id);
  const [schedule, runRows, newLeads, sent, bounced, failed, movedToCallDeck, replies, readyToSend, heldBack] = await Promise.all([
    getPipelineSchedule(source.scheduleId),
    prisma.pipelineRun.findMany({ where: { pipeline: id, kind: "daily", startedAt: { gte: since } }, orderBy: { startedAt: "asc" } }),
    countRows(source.leadTable, "createdAt", since),
    countRows(source.logTable, "sentAt", since),
    countRows(source.logTable, "bouncedAt", since),
    countRows(source.leadTable, "lastSendFailedAt", since),
    countRows(
      source.activityTable,
      "date",
      since,
      Prisma.sql`AND left("notes", ${CALL_DECK_NOTE_PREFIX.length}) = ${CALL_DECK_NOTE_PREFIX}`,
    ),
    countReplies(id, since),
    adapter.countSendable(prisma),
    adapter.countBlockedNew(prisma),
  ]);

  const runs: RunLine[] = runRows.map((r) => {
    const status = displayRunStatus(r, now);
    return {
      status,
      startedAt: r.startedAt,
      summary: r.summary ?? (status === "interrupted" ? "The run was cut off before it could record what it did." : null),
      errors: r.errors ? r.errors.split("\n").filter(Boolean) : [],
      hitTimeLimit: status === "interrupted" || /out of time/.test(r.summary ?? ""),
    };
  });

  const problems: string[] = [];
  // A weekdays-only pipeline doesn't run on Saturday or Sunday (Arizona time), so a report then may cover no run.
  const restDay = source.weekdaysOnly && [0, 6].includes(new Date(`${dayKey(now)}T12:00:00Z`).getUTCDay());
  if (schedule.enabled && !outboundPaused && runs.length === 0 && !restDay)
    problems.push("The daily run didn't happen in the last 24 hours.");
  for (const run of runs) {
    if (run.status === "failed") problems.push("The daily run failed.");
    else if (run.status === "partial") problems.push("The daily run only partly worked.");
    else if (run.status === "interrupted") problems.push("The daily run was cut off by the platform's time limit before it finished.");
    if (run.hitTimeLimit && run.status !== "interrupted") problems.push("The daily run ran out of time before it finished.");
  }
  if (failed) problems.push(`${plural(failed, "send", "sends")} failed.`);
  if (bounced) problems.push(`${plural(bounced, "email", "emails")} bounced.`);
  if (replies.repliesNeedingLook) problems.push(`${plural(replies.repliesNeedingLook, "reply needs", "replies need")} a look.`);

  return {
    id,
    label: PIPELINE_LABEL[id],
    enabled: schedule.enabled,
    runTime: source.runTime,
    runs,
    businessesChecked: runRows.reduce((sum, r) => sum + (r.businessesChecked ?? 0), 0),
    newLeads,
    sent,
    failed,
    bounced,
    ...replies,
    movedToCallDeck,
    readyToSend,
    heldBack,
    problems,
  };
}

export async function buildDailyReport(now: Date = new Date()): Promise<DailyReport> {
  const since = new Date(now.getTime() - WINDOW_MS);
  const settings = await getAppSettings();
  const [sections, unmatchedRow, staleRuns] = await Promise.all([
    Promise.all(PIPELINE_IDS.map((id) => buildSection(id, since, now, settings.outboundPaused))),
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*)::bigint AS n FROM "InboundReply"
      WHERE "receivedAt" >= ${utc(since)} AND "kind" = 'reply' AND cardinality("matched") = 0 AND "resolvedAt" IS NULL`,
    prisma.pipelineRun.findMany({ where: { pipeline: "all", kind: "stale-contacts", startedAt: { gte: since } } }),
  ]);
  const staleFailed = staleRuns.some((r) => ["failed", "interrupted"].includes(displayRunStatus(r, now)));
  return {
    since,
    now,
    outboundPaused: settings.outboundPaused,
    unmatchedReplies: Number(unmatchedRow[0]?.n ?? 0),
    staleContactsProblem: staleFailed
      ? "The job that moves silent leads to the call deck failed, so the call-deck numbers may be low."
      : staleRuns.length === 0
        ? "The job that moves silent leads to the call deck didn't run in the last 24 hours."
        : null,
    // Pipelines that are on first, in registry order.
    sections: [...sections.filter((s) => s.enabled), ...sections.filter((s) => !s.enabled)],
  };
}

const STATUS_WORD: Record<string, string> = {
  succeeded: "Succeeded",
  partial: "Partly worked",
  failed: "Failed",
  skipped: "Skipped",
  interrupted: "Cut off (time limit)",
  running: "Still running",
};

function renderSection(s: PipelineSection): string[] {
  const title = s.label.toUpperCase();
  if (!s.enabled) {
    const extra =
      s.sent || s.replies || s.optOuts
        ? ` (in the last 24 hours: ${s.sent} sent by hand, ${s.replies} replies, ${s.optOuts} opt-outs)`
        : "";
    return [`${title}: daily run is turned off${extra}.`];
  }
  const lines = [`${title} (runs ${s.runTime})`, "-".repeat(title.length)];
  lines.push(s.problems.length ? `Needs attention: ${s.problems.join(" ")}` : "All good.");
  lines.push("");
  if (s.runs.length === 0) lines.push("Run: none in the last 24 hours.");
  for (const run of s.runs) {
    lines.push(`Run: ${STATUS_WORD[run.status] ?? run.status}, started ${formatDateTime(run.startedAt)}.`);
    if (run.summary) lines.push(`  ${run.summary}`);
  }
  lines.push(
    "",
    `Businesses checked:     ${s.businessesChecked}`,
    `New leads added:        ${s.newLeads}`,
    `Emails sent:            ${s.sent}`,
    `Failed sends:           ${s.failed}`,
    `Bounced:                ${s.bounced}`,
    `Replies:                ${s.replies}${s.repliesNeedingLook ? ` (${s.repliesNeedingLook} need a look)` : ""}`,
    `Opt-outs:               ${s.optOuts}`,
    `Automatic replies:      ${s.autoReplies}`,
    `Moved to the call deck: ${s.movedToCallDeck}`,
    `Waiting to be emailed:  ${s.readyToSend} ready, ${s.heldBack} held back`,
  );
  const errors = s.runs.flatMap((r) => r.errors);
  if (errors.length) {
    lines.push("", "Errors from the run:");
    const shown = errors.slice(0, 10);
    for (const e of shown) lines.push(`  - ${e}`);
    if (errors.length > shown.length) lines.push(`  - …and ${errors.length - shown.length} more (see the pipeline's page).`);
  }
  return lines;
}

/** The report as an email: a subject that says the headline, and a plain-text body with a section per pipeline. */
export function renderDailyReport(report: DailyReport): { subject: string; text: string } {
  const active = report.sections.filter((s) => s.enabled);
  const sent = active.reduce((n, s) => n + s.sent, 0);
  const replies = report.sections.reduce((n, s) => n + s.replies, 0);
  const problems =
    active.reduce((n, s) => n + s.problems.length, 0) + (report.outboundPaused ? 1 : 0) + (report.staleContactsProblem ? 1 : 0);
  const subject =
    `Pipelines report, ${formatDate(report.now)}: ${plural(sent, "email", "emails")} sent, ${plural(replies, "reply", "replies")}` +
    (problems ? `, ${plural(problems, "thing needs", "things need")} attention` : "");

  const lines = [`How each pipeline ran from ${formatDateTime(report.since)} to ${formatDateTime(report.now)}.`, ""];
  if (report.outboundPaused) lines.push("Outbound email is PAUSED in Settings, so no pipeline is sending.", "");
  if (report.staleContactsProblem) lines.push(report.staleContactsProblem, "");
  if (report.unmatchedReplies) {
    lines.push(`${plural(report.unmatchedReplies, "reply", "replies")} came in that couldn't be matched to a lead (see Replies).`, "");
  }
  if (active.length === 0) lines.push("No pipeline's daily run is turned on.", "");
  for (const section of report.sections) lines.push(...renderSection(section), "");
  lines.push(
    'Notes: bounces only count once a bounce notice arrives or you click "Mark bounced". ' +
      '"Held back" leads have an address but are blocked from sending (unverified address, or a reply waiting for a look).',
  );
  const appUrl = reportAppUrl();
  if (appUrl) lines.push("", appUrl);
  return { subject, text: lines.join("\n") };
}
