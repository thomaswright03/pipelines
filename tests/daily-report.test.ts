import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { GET as reportGET } from "@/app/api/cron/daily-report/route";
import { buildDailyReport, renderDailyReport, reportAppUrl } from "@/lib/daily-report";
import { savePipelineSchedule, DATALEADSELL_SCHEDULE_ID, GARBAGE_AI_SCHEDULE_ID, VAULT_SCHEDULE_ID } from "@/lib/pipeline-schedule";
import { setOutboundPaused } from "@/lib/outreach/settings";
import { captureMail, makeColdLead, makeHaulerLead, smtpError } from "./helpers";

function cron(auth: string | null = "Bearer test-cron-secret") {
  return reportGET(new NextRequest("http://localhost/api/cron/daily-report", { headers: auth === null ? {} : { authorization: auth } }));
}

const HOUR = 3_600_000;
const ago = (hours: number) => new Date(Date.now() - hours * HOUR);

let mail: ReturnType<typeof captureMail>;
afterEach(() => mail?.restore());

/** Yesterday-into-today activity: a Cold Outreach run that ran out of time, a Garbage AI run, sends, a bounce, a reply, an opt-out, a call-deck move. */
async function seedDay() {
  await prisma.pipelineRun.create({
    data: {
      pipeline: "cold-outreach",
      kind: "daily",
      status: "succeeded",
      startedAt: ago(1.5),
      finishedAt: ago(1.49),
      summary:
        "Searched Mesa, AZ: Yelp listed 50 businesses, checked 3 for an email (stopped early: out of time), found 1 new address, emailed 1.",
      businessesChecked: 3,
      leadsFound: 1,
      emailsSent: 1,
    },
  });
  await prisma.pipelineRun.create({
    data: {
      pipeline: "garbage-ai",
      kind: "daily",
      status: "partial",
      startedAt: ago(2),
      finishedAt: ago(1.99),
      summary: "Searched Boise, ID: Yelp listed 12 haulers, checked 12 for an email, found 2 new addresses, emailed 2, 1 failed to send.",
      errors: "Acme Hauling: Couldn't reach the email service — nothing was sent.",
      businessesChecked: 12,
      leadsFound: 2,
      emailsSent: 2,
    },
  });
  // An older run, outside the window, must not count.
  await prisma.pipelineRun.create({
    data: { pipeline: "cold-outreach", kind: "daily", status: "succeeded", startedAt: ago(26), businessesChecked: 40, emailsSent: 9 },
  });
  await prisma.pipelineRun.create({ data: { pipeline: "all", kind: "stale-contacts", status: "succeeded", startedAt: ago(5) } });

  const cold = await makeColdLead({ status: "contacted", lastEmailedAt: ago(1.5) });
  await prisma.leadEmailSendLog.create({
    data: { leadId: cold.id, email: cold.email!, sentAt: ago(1.5), bounced: true, bouncedAt: ago(1) },
  });
  await prisma.leadEmailSendLog.create({ data: { leadId: cold.id, email: cold.email!, sentAt: ago(30) } });
  const moved = await makeColdLead({ status: "cold_call_list", createdAt: ago(200) });
  await prisma.leadActivity.create({
    data: {
      leadId: moved.id,
      type: "note",
      notes: "Moved to the call deck — no reply 7 days after the pitch sent Sep 22, 2026.",
      date: ago(5),
    },
  });

  const haulers = [await makeHaulerLead({ status: "contacted" }), await makeHaulerLead({ status: "contacted" })];
  for (const h of haulers) await prisma.haulerEmailSendLog.create({ data: { leadId: h.id, email: h.email!, sentAt: ago(2) } });
  await makeHaulerLead({ name: "Acme Hauling", lastSendFailedAt: ago(2), lastSendFailure: "Couldn't reach the email service." });
  await prisma.inboundReply.create({
    data: {
      dedupeKey: "mid:1",
      fromEmail: haulers[0].email!,
      optedOut: false,
      matched: [`garbage-ai:${haulers[0].id}`],
      kind: "reply",
      verdict: "positive",
    },
  });
  await prisma.inboundReply.create({
    data: {
      dedupeKey: "mid:2",
      fromEmail: haulers[1].email!,
      optedOut: true,
      matched: [`garbage-ai:${haulers[1].id}`],
      kind: "reply",
      verdict: "opt_out",
    },
  });
  await prisma.inboundReply.create({
    data: { dedupeKey: "mid:3", fromEmail: "who@else.test", optedOut: false, matched: [], kind: "reply" },
  });
}

describe("daily report contents", () => {
  it("has a section per pipeline with the last 24 hours' numbers", async () => {
    await savePipelineSchedule(VAULT_SCHEDULE_ID, { enabled: true, businessesPerRun: 50 });
    await savePipelineSchedule(GARBAGE_AI_SCHEDULE_ID, { enabled: true, businessesPerRun: 30 });
    await seedDay();

    const report = await buildDailyReport();
    const byId = Object.fromEntries(report.sections.map((s) => [s.id, s]));

    expect(report.sections.map((s) => s.id)).toEqual(["cold-outreach", "garbage-ai", "dataleadsell"]);
    expect(byId["cold-outreach"]).toMatchObject({
      enabled: true,
      businessesChecked: 3,
      sent: 1,
      bounced: 1,
      movedToCallDeck: 1,
      replies: 0,
    });
    expect(byId["cold-outreach"].problems.join(" ")).toMatch(/ran out of time/);
    expect(byId["cold-outreach"].problems.join(" ")).toMatch(/1 email bounced/);
    expect(byId["garbage-ai"]).toMatchObject({ businessesChecked: 12, sent: 2, failed: 1, replies: 1, optOuts: 1 });
    expect(byId["garbage-ai"].problems.join(" ")).toMatch(/only partly worked/);
    expect(byId.dataleadsell.enabled).toBe(false);
    expect(report.unmatchedReplies).toBe(1);
    expect(report.staleContactsProblem).toBeNull();

    const { subject, text } = renderDailyReport(report);
    expect(subject).toMatch(/3 emails sent, 1 reply, \d+ things need attention/);
    expect(text).toMatch(/COLD OUTREACH \(daily run 8:33 AM Arizona time\)/);
    expect(text).toMatch(/GARBAGE AI \(daily run 8:00 AM Arizona time\)/);
    expect(text).toMatch(/DATALEADSELL\.COM: daily run is turned off\./);
    expect(text).toMatch(/Acme Hauling: Couldn't reach the email service/);
    expect(text).toMatch(/1 reply came in that couldn't be matched/);
  });

  it("flags a turned-on pipeline whose run didn't happen, and a paused outbox", async () => {
    await savePipelineSchedule(DATALEADSELL_SCHEDULE_ID, { enabled: true, businessesPerRun: 10 });
    await setOutboundPaused(true);

    const report = await buildDailyReport();
    const { text } = renderDailyReport(report);

    // Paused: a missing run is expected, not a problem.
    expect(report.sections.every((s) => !s.problems.some((p) => /didn't happen/.test(p)))).toBe(true);
    expect(text).toMatch(/PAUSED in Settings/);
    expect(text).toMatch(/call deck didn't run/);

    await setOutboundPaused(false);
    const unpaused = await buildDailyReport();
    expect(unpaused.sections.find((s) => s.id === "dataleadsell")!.problems).toContain("The daily run didn't happen in the last 24 hours.");
  });
});

describe("the report's link to the app", () => {
  it("uses DAILY_REPORT_APP_URL, else the Vercel production domain, else leaves the link out", async () => {
    expect(reportAppUrl({ DAILY_REPORT_APP_URL: "https://staging.example.test", VERCEL_PROJECT_PRODUCTION_URL: "prod.example.test" })).toBe(
      "https://staging.example.test",
    );
    expect(reportAppUrl({ VERCEL_PROJECT_PRODUCTION_URL: "prod.example.test" })).toBe("https://prod.example.test");
    expect(reportAppUrl({})).toBeNull();

    const report = await buildDailyReport(new Date());
    expect(renderDailyReport(report).text).not.toMatch(/https?:\/\//);
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "pipelines.example.test");
    expect(renderDailyReport(report).text.endsWith("\n\nhttps://pipelines.example.test")).toBe(true);
  });
});

describe("daily report cron", () => {
  it("refuses requests without the secret", async () => {
    expect((await cron(null)).status).toBe(401);
    expect((await cron("Bearer nope")).status).toBe(401);
  });

  it("emails one report to the owner, records the run, and doesn't send twice", async () => {
    mail = captureMail();
    await seedDay();

    const res = await cron();
    expect(res.status).toBe(200);
    expect(mail.messages).toHaveLength(1);
    expect(mail.messages[0]).toMatchObject({ to: "t@thomasewright.com", from: "thomas@wright-ai-solutions.com" });
    expect(mail.messages[0].subject).toMatch(/^Pipelines report, /);
    expect(mail.messages[0].headers).toBeUndefined();
    const run = await prisma.pipelineRun.findFirstOrThrow({ where: { kind: "daily-report" } });
    expect(run).toMatchObject({ pipeline: "all", status: "succeeded" });

    const again = await (await cron()).json();
    expect(again).toMatchObject({ status: "skipped" });
    expect(mail.messages).toHaveLength(1);
  });

  it("records a failed send, and tries again on the next call", async () => {
    mail = captureMail();
    mail.fail(smtpError("connect ECONNREFUSED", { code: "ESOCKET", syscall: "connect" }), 1);

    const res = await cron();
    expect(res.status).toBe(500);
    expect((await res.json()).errors[0]).toMatch(/Couldn't reach the email service/);

    const retry = await cron();
    expect(retry.status).toBe(200);
    expect(mail.messages).toHaveLength(1);
  });

  it("sends nothing while the environment's emergency stop is on", async () => {
    mail = captureMail();
    vi.stubEnv("OUTBOUND_EMAIL_DISABLED", "1");

    const res = await cron();
    expect(res.status).toBe(500);
    expect(mail.messages).toHaveLength(0);
  });
});
