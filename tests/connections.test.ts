// Settings → Connections: a broken integration is shown as broken, in plain
// words with the next step, instead of looking like "nobody replied".
import { afterEach, describe, expect, it } from "vitest";
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
import { DATALEADSELL_SCHEDULE_ID } from "@/lib/pipeline-schedule-rules";
import { captureMail, makeColdLead, smtpError, stubFetch, YELP_PREFIX, yelpResponse } from "./helpers";

const DAY_MS = 86_400_000;
const ENV = { EMAIL_TRANSPORT: "zeptomail", EMAIL_INBOUND_SECRET: "s", YELP_API_KEY: "k", CRON_SECRET: "c", VERCEL: "1" };

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
    expect(s.yelp).toMatchObject({ tone: "warn", badge: "Not confirmed yet", testable: true });
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

  it("Test connection: a rejected email login and a rejected Yelp key are shown as failures, in plain words", async () => {
    mail = captureMail();
    mail.fail(smtpError("Invalid login: 535 Authentication Failed", { code: "EAUTH", responseCode: 535 }));
    const mailResult = await testConnectionAction("mail");
    expect(mailResult).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^Email service: The email service turned down our login/),
    });
    expect(mail.messages).toHaveLength(0);
    expect((await statusOf()).mail).toMatchObject({ tone: "error", summary: expect.stringMatching(/connection test .* failed/) });

    stubFetch({
      [YELP_PREFIX]: () => ({ status: 401, contentType: "application/json", body: JSON.stringify({ error: { code: "TOKEN_INVALID" } }) }),
    });
    expect(await testConnectionAction("yelp")).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^Yelp: Yelp rejected our access key/),
    });
    expect((await statusOf()).yelp).toMatchObject({ tone: "error", summary: expect.stringMatching(/rejected our access key/) });
  });

  it("Test connection: success turns each service green with the time, without sending anything", async () => {
    mail = captureMail();
    expect(await testConnectionAction("mail")).toMatchObject({
      ok: true,
      message: expect.stringMatching(/logged in at .* No email was sent/),
    });
    expect(mail.messages).toHaveLength(0);
    const { calls } = stubFetch({ [YELP_PREFIX]: () => yelpResponse([{ name: "One Shop" }]) });
    expect(await testConnectionAction("yelp")).toMatchObject({ ok: true });
    expect(calls[0]).toContain("limit=1");

    const s = await statusOf();
    expect(s.mail).toMatchObject({ tone: "ok", summary: expect.stringMatching(/Connection test passed/) });
    expect(s.yelp).toMatchObject({ tone: "ok", summary: expect.stringMatching(/^Yelp last answered/) });
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
    expect(s.yelp.badge).toBe("Not confirmed yet");
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
    stubFetch({ [YELP_PREFIX]: () => yelpResponse([]) });
    await testConnectionAction("yelp");
    for (const [pipeline, kind] of [
      ["cold-outreach", "daily"],
      ["all", "stale-contacts"],
    ]) {
      await prisma.pipelineRun.create({ data: { pipeline, kind, status: "succeeded", summary: "Done.", finishedAt: new Date() } });
    }

    const s = await statusOf();

    for (const key of ["mail", "replies", "daily-run", "stale-contacts", "yelp"]) expect(s[key]!.tone, key).toBe("ok");
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
    expect(s.yelp).toMatchObject({ tone: "error", summary: expect.stringMatching(/Yelp isn't set up/) });
    expect(s.mail).toMatchObject({ tone: "warn", summary: expect.stringMatching(/Test mode/) });
  });

  it("never shows setting names or README references to the operator", async () => {
    const all = [...(await getConnectionStatus({ VERCEL: "1", EMAIL_TRANSPORT: "outbox" })), ...(await getConnectionStatus(ENV))];
    for (const item of all) {
      const text = `${item.summary} ${item.next ?? ""}`;
      expect(text, item.key).not.toMatch(/README|[A-Z]{3,}_[A-Z_]{3,}/);
    }
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
      return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"} Arizona time`;
    };
    for (const cron of vercel.crons) {
      const job = CRON_JOBS.find((j) => j.path === cron.path);
      expect(job, `Settings → Connections has no row for ${cron.path}`).toBeDefined();
      expect(job!.schedule, cron.path).toBe(arizona(cron.schedule));
    }
    expect(CRON_JOBS.map((j) => j.path).sort()).toEqual(vercel.crons.map((c) => c.path).sort());
  });

  it("shows the dataleadsell run and the daily report on a fresh install, the dataleadsell run as switched off", async () => {
    const s = await statusOf();
    expect(s["dataleadsell-daily"]).toMatchObject({
      label: "Daily dataleadsell run",
      tone: "off",
      badge: "Off",
      summary: expect.stringMatching(/Switched off.*9:03 AM Arizona time/),
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
    await savePipelineSchedule(DATALEADSELL_SCHEDULE_ID, { enabled: true, businessesPerRun: 10 });
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
