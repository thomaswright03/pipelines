// Settings → Connections: a broken integration is shown as broken, in plain
// words with the next step, instead of looking like "nobody replied".
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { POST } from "@/app/api/email-inbound/route";
import { getConnectionStatus } from "@/lib/integration-status";
import { sendFirstTouch } from "@/lib/outreach/send";
import { setOutboundPaused } from "@/lib/outreach/settings";
import { testConnectionAction } from "@/lib/actions/settings";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CRON_JOBS } from "@/lib/integration-status";
import { savePipelineSchedule } from "@/lib/pipeline-schedule";
import { DAILY_RUNS, DATALEADSELL_SCHEDULE_ID } from "@/lib/pipeline-schedule-rules";
import { captureMail, makeColdLead, seedPlaces, smtpError } from "./helpers";

const DAY_MS = 86_400_000;
const ENV = { EMAIL_TRANSPORT: "zeptomail", EMAIL_INBOUND_SECRET: "s", CRON_SECRET: "c", VERCEL: "1" };

let mail: ReturnType<typeof captureMail> | undefined;
afterEach(() => mail?.restore());

async function statusOf(env: Record<string, string | undefined> = ENV, now = new Date()) {
  return Object.fromEntries((await getConnectionStatus(env, now)).map((s) => [s.key, s]));
}

describe("Settings → Connections", () => {
  it("claims nothing is working on a fresh install: every service is 'Not confirmed yet'", async () => {
    const s = await statusOf();
    expect(s.replies).toMatchObject({ tone: "warn", badge: "Not confirmed yet", next: expect.stringMatching(/mark the reply by hand/) });
    expect(s.mail).toMatchObject({ tone: "warn", badge: "Not confirmed yet", testable: true });
    expect(s.places).toMatchObject({ tone: "error", summary: expect.stringMatching(/business list is empty/), testable: false });
  });

  it("shows how much of the business list is loaded, and warns once the monthly import is overdue", async () => {
    await seedPlaces([{ name: "One" }, { name: "Two" }], {
      cities: [
        { city: "Mesa", state: "AZ" },
        { city: "Provo", state: "UT" },
      ],
    });
    expect((await statusOf()).places).toMatchObject({
      tone: "ok",
      summary: expect.stringMatching(/^4 businesses in 2 cities, loaded /),
      next: null,
    });
    await prisma.place.create({
      data: { id: "g:0x1:0x2", name: "Mesa Dumpsters", city: "Mesa", state: "AZ", kinds: ["hauler"], refreshedAt: new Date() },
    });
    expect((await statusOf()).places).toMatchObject({
      summary: expect.stringMatching(/^5 businesses \(1 from Google Maps\) in 2 cities, loaded /),
    });
    const later = new Date(Date.now() + 40 * DAY_MS);
    expect((await statusOf(ENV, later)).places).toMatchObject({
      tone: "warn",
      summary: expect.stringMatching(/monthly import seems to have stopped/),
      next: expect.stringMatching(/Import business list/),
    });
  });

  it("shows replies as working once one arrives, with its time", async () => {
    await POST(
      new NextRequest("http://localhost/api/email-inbound", {
        method: "POST",
        headers: { authorization: "Bearer test-inbound-secret", "content-type": "application/json" },
        body: JSON.stringify({ from: "anyone@x.test", text: "Sounds good" }),
      }),
    );
    expect((await statusOf()).replies).toMatchObject({ tone: "ok", summary: expect.stringMatching(/^Last reply received /) });
  });

  it("warns when emails went out 10 days ago and nothing has come back", async () => {
    await prisma.outreachRecipient.create({
      data: { pipeline: "cold-outreach", email: "a@x.test", state: "sent", sentAt: new Date(Date.now() - 10 * DAY_MS) },
    });
    expect((await statusOf()).replies).toMatchObject({ tone: "warn", summary: expect.stringMatching(/no reply of any kind/) });
  });

  it("Test connection: a rejected email login is shown as a failure, in plain words", async () => {
    mail = captureMail();
    mail.fail(smtpError("Invalid login: 535 Authentication Failed", { code: "EAUTH", responseCode: 535 }));
    const mailResult = await testConnectionAction("mail");
    expect(mailResult).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^Email service: The email service turned down our login/),
    });
    expect(mail.messages).toHaveLength(0);
    expect((await statusOf()).mail).toMatchObject({ tone: "error", summary: expect.stringMatching(/connection test .* failed/) });
  });

  it("Test connection: success turns email green with the time, without sending anything", async () => {
    mail = captureMail();
    expect(await testConnectionAction("mail")).toMatchObject({
      ok: true,
      message: expect.stringMatching(/logged in at .* No email was sent/),
    });
    expect(mail.messages).toHaveLength(0);

    const s = await statusOf();
    expect(s.mail).toMatchObject({ tone: "ok", summary: expect.stringMatching(/Connection test passed/) });
  });

  it("shows the missing replies and a failed daily run in plain words, with what to do", async () => {
    // Emails went out 3 days ago and no reply has ever come back.
    await prisma.outreachRecipient.create({
      data: { pipeline: "cold-outreach", email: "a@x.test", state: "sent", sentAt: new Date(Date.now() - 3 * DAY_MS) },
    });
    await prisma.pipelineRun.create({
      data: {
        pipeline: "cold-outreach",
        kind: "daily",
        status: "failed",
        summary: "The run stopped with an error.",
        finishedAt: new Date(),
      },
    });

    const s = await statusOf();

    expect(s.replies).toMatchObject({
      tone: "warn",
      summary: expect.stringMatching(/no reply of any kind .* has ever arrived/),
      next: expect.stringMatching(/tell your developer/i),
    });
    expect(s["daily-run"]).toMatchObject({ tone: "error", summary: expect.stringMatching(/failed — The run stopped with an error/) });
    expect(s["stale-contacts"]).toMatchObject({ tone: "warn", summary: expect.stringMatching(/^Has never run/) });
  });

  it("goes green after a successful send, a posted reply and good runs", async () => {
    mail = captureMail();
    const lead = await makeColdLead({ email: "ok@x.test" });
    expect(await sendFirstTouch("cold-outreach", lead.id)).toMatchObject({ ok: true });
    await POST(
      new NextRequest("http://localhost/api/email-inbound", {
        method: "POST",
        headers: { authorization: "Bearer test-inbound-secret", "content-type": "application/json" },
        body: JSON.stringify({ from: "ok@x.test", subject: "Re: hi", text: "Sounds good" }),
      }),
    );
    await seedPlaces([{ name: "One Shop" }], { cities: [{ city: "Mesa", state: "AZ" }] });
    for (const [pipeline, kind] of [
      ["cold-outreach", "daily"],
      ["all", "stale-contacts"],
    ]) {
      await prisma.pipelineRun.create({ data: { pipeline, kind, status: "succeeded", summary: "Done.", finishedAt: new Date() } });
    }

    const s = await statusOf();

    for (const key of ["mail", "replies", "daily-run", "stale-contacts", "places"]) expect(s[key]!.tone, key).toBe("ok");
    expect(s.mail!.summary).toMatch(/Last email sent/);
    expect(s.replies!.summary).toMatch(/Last reply received/);
  });

  it("shows a failed send until a later one succeeds, and says when sending is paused", async () => {
    mail = captureMail();
    mail.fail(smtpError("Invalid login", { code: "EAUTH", responseCode: 535 }), 1);
    const lead = await makeColdLead();
    expect(await sendFirstTouch("cold-outreach", lead.id)).toMatchObject({ ok: false, reason: "send_failed" });

    expect((await statusOf()).mail).toMatchObject({
      tone: "error",
      summary: expect.stringMatching(/The last send failed .*rejected our login/),
    });

    expect(await sendFirstTouch("cold-outreach", lead.id)).toMatchObject({ ok: true });
    await setOutboundPaused(true);
    expect((await statusOf()).mail).toMatchObject({ tone: "warn", summary: expect.stringMatching(/paused/) });
  });

  it("flags missing secrets and test-mode mail", async () => {
    const s = await statusOf({ VERCEL: "1", EMAIL_TRANSPORT: "outbox" });
    expect(s.replies).toMatchObject({ tone: "error", summary: expect.stringMatching(/Reply forwarding isn't switched on/) });
    expect(s["daily-run"]).toMatchObject({ tone: "error", summary: expect.stringMatching(/password isn't set on the server/) });
    expect(s.mail).toMatchObject({ tone: "warn", summary: expect.stringMatching(/Test mode/) });
  });

  it("never shows setting names or README references to the operator", async () => {
    const all = [...(await getConnectionStatus({ VERCEL: "1", EMAIL_TRANSPORT: "outbox" })), ...(await getConnectionStatus(ENV))];
    vi.stubEnv("OUTBOUND_EMAIL_DISABLED", "1");
    all.push(...(await getConnectionStatus(ENV)));
    for (const item of all) {
      const text = `${item.summary} ${item.next ?? ""}`;
      expect(text, item.key).not.toMatch(/README|[A-Z]{3,}_[A-Z_]{3,}|redeploy|hosting environment/);
    }
  });

  it("switched off by the hosting: says so plainly and who to ask, with the setting only in the developer line", async () => {
    vi.stubEnv("OUTBOUND_EMAIL_DISABLED", "1");
    const mail = (await statusOf())["mail"];
    expect(mail).toMatchObject({
      tone: "warn",
      summary: expect.stringContaining("Sending is switched off by whoever manages the app's hosting (usually your developer)"),
      next: "Ask whoever manages the app's hosting to turn sending back on when it should resume.",
      detail: expect.stringMatching(/^For your developer: the OUTBOUND_EMAIL_DISABLED environment variable is set\./),
    });
  });

  it("warns when a job hasn't run for over a day", async () => {
    await prisma.pipelineRun.create({
      data: {
        pipeline: "all",
        kind: "stale-contacts",
        status: "succeeded",
        startedAt: new Date(Date.now() - 2 * DAY_MS),
        finishedAt: new Date(),
      },
    });
    expect((await statusOf())["stale-contacts"]).toMatchObject({ tone: "warn", summary: expect.stringMatching(/over a day ago/) });
  });

  it("has a row for every job scheduled in vercel.json, at its real time", () => {
    const vercel = JSON.parse(readFileSync(path.resolve(__dirname, "../vercel.json"), "utf8")) as {
      crons: { path: string; schedule: string }[];
    };
    const arizona = (cron: string) => {
      const [minute, hourUtc] = cron.split(" ").map(Number) as [number, number];
      const hour = (hourUtc - 7 + 24) % 24; // Arizona is UTC-7 all year (no daylight saving).
      return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
    };
    const byPath = new Map<string, string[]>();
    for (const cron of vercel.crons) byPath.set(cron.path, [...(byPath.get(cron.path) ?? []), cron.schedule]);
    for (const [cronPath, schedules] of byPath) {
      const job = CRON_JOBS.find((j) => j.path === cronPath);
      expect(job, `Settings → Connections has no row for ${cronPath}`).toBeDefined();
      const hours = schedules.map((c) => Number(c.split(" ")[1]));
      // Every entry of a job runs on the same days: every day, or Monday to Friday ("1-5").
      const days = new Set(schedules.map((c) => c.split(" ").slice(2).join(" ")));
      expect(days.size, cronPath).toBe(1);
      const weekdays = [...days][0] === "* * 1-5";
      if (!weekdays) expect([...days][0], cronPath).toBe("* * *");
      expect(Boolean(job!.weekdaysOnly), cronPath).toBe(weekdays);
      const expected =
        (schedules.length === 1
          ? `daily at ${arizona(schedules[0]!)} Arizona time`
          : `every hour from ${arizona(schedules[0]!)} to ${arizona(schedules.at(-1)!)} Arizona time`) +
        (weekdays ? ", Monday to Friday" : "");
      if (schedules.length > 1) {
        // An hour apart, all at the same minute.
        expect(hours, cronPath).toEqual(hours.map((_, i) => hours[0]! + i));
        expect(new Set(schedules.map((c) => c.split(" ")[0])).size, cronPath).toBe(1);
        expect(schedules.length, cronPath).toBe(DAILY_RUNS);
      }
      expect(job!.schedule, cronPath).toBe(expected);
    }
    expect(CRON_JOBS.map((j) => j.path).sort()).toEqual([...byPath.keys()].sort());
  });

  it("shows the dataleadsell run and the daily report on a fresh install, the dataleadsell run as switched off", async () => {
    const s = await statusOf();
    expect(s["dataleadsell-daily"]).toMatchObject({
      label: "Daily dataleadsell run",
      tone: "off",
      badge: "Off",
      summary: expect.stringMatching(/Switched off.*every hour from 9:03 AM to 4:03 PM Arizona time/),
      link: { href: "/dataleadsell" },
    });
    expect(s["daily-report"]).toMatchObject({ tone: "warn", summary: expect.stringMatching(/Has never run.*10:00 AM Arizona time/) });

    // A run the operator switched off still records a skipped run each day: still Off, not a problem.
    await prisma.pipelineRun.create({
      data: {
        pipeline: "dataleadsell",
        kind: "daily",
        status: "skipped",
        summary: "Daily automation is turned off.",
        finishedAt: new Date(),
      },
    });
    expect((await statusOf())["dataleadsell-daily"]).toMatchObject({ tone: "off", summary: expect.stringMatching(/skipped/) });

    // Switched on: monitored like the other daily runs.
    await savePipelineSchedule(DATALEADSELL_SCHEDULE_ID, { enabled: true, emailsPerDay: 10 });
    await prisma.pipelineRun.create({
      data: { pipeline: "dataleadsell", kind: "daily", status: "failed", summary: "Yelp failed.", finishedAt: new Date() },
    });
    expect((await statusOf())["dataleadsell-daily"]).toMatchObject({
      tone: "error",
      next: expect.stringMatching(/^Open the dataleadsell\.com page/),
      link: { href: "/dataleadsell", label: "Open the dataleadsell.com page" },
    });
  });

  it("points each failed job at its own page, never another pipeline's", async () => {
    for (const [pipeline, kind] of [
      ["garbage-ai", "daily"],
      ["all", "stale-contacts"],
      ["all", "daily-report"],
    ]) {
      await prisma.pipelineRun.create({ data: { pipeline, kind, status: "failed", summary: "It broke.", finishedAt: new Date() } });
    }
    const s = await statusOf();
    expect(s["garbage-ai-daily"]).toMatchObject({
      tone: "error",
      next: expect.stringMatching(/Garbage AI page/),
      link: { href: "/garbage-ai" },
    });
    expect(s["stale-contacts"]).toMatchObject({ tone: "error", next: expect.stringMatching(/call decks/), link: { href: "/" } });
    expect(s["daily-report"]).toMatchObject({
      tone: "error",
      next: expect.stringMatching(/Test connection/),
      link: { href: "#connection-mail" },
    });
    for (const key of ["garbage-ai-daily", "stale-contacts", "daily-report"]) expect(s[key]!.next, key).not.toMatch(/Cold Outreach/);
  });
});
