// Settings → Connections: a broken integration is shown as broken, in plain
// words with the next step, instead of looking like "nobody replied".
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { POST } from "@/app/api/email-inbound/route";
import { getConnectionStatus } from "@/lib/integration-status";
import { sendFirstTouch } from "@/lib/outreach/send";
import { setOutboundPaused } from "@/lib/outreach/settings";
import { captureMail, makeColdLead, smtpError } from "./helpers";

const DAY_MS = 86_400_000;
const ENV = { EMAIL_TRANSPORT: "zeptomail", EMAIL_INBOUND_SECRET: "s", YELP_API_KEY: "k", CRON_SECRET: "c", VERCEL: "1" };

let mail: ReturnType<typeof captureMail> | undefined;
afterEach(() => mail?.restore());

async function statusOf(env: Record<string, string | undefined> = ENV, now = new Date()) {
  return Object.fromEntries((await getConnectionStatus(env, now)).map((s) => [s.key, s]));
}

describe("Settings → Connections", () => {
  it("shows the missing replies and a failed daily run in plain words, with what to do", async () => {
    // Emails went out 3 days ago and nothing has come back since.
    await prisma.outreachRecipient.create({
      data: { pipeline: "cold-outreach", email: "a@x.test", state: "sent", sentAt: new Date(Date.now() - 3 * DAY_MS) },
    });
    await prisma.pipelineRun.create({
      data: { pipeline: "cold-outreach", kind: "daily", status: "failed", summary: "The run stopped with an error.", finishedAt: new Date() },
    });

    const s = await statusOf();

    expect(s.replies).toMatchObject({ tone: "warn", summary: expect.stringMatching(/no reply of any kind has arrived for a week/), next: expect.stringMatching(/Worker/) });
    expect(s["daily-run"]).toMatchObject({ tone: "error", summary: expect.stringMatching(/failed — The run stopped with an error/) });
    expect(s["stale-contacts"]).toMatchObject({ tone: "warn", summary: expect.stringMatching(/^Has never run/) });
    expect(s.yelp.tone).toBe("ok");
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
    for (const [pipeline, kind] of [["cold-outreach", "daily"], ["all", "stale-contacts"]]) {
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

    expect((await statusOf()).mail).toMatchObject({ tone: "error", summary: expect.stringMatching(/The last send failed .*rejected our login/) });

    expect(await sendFirstTouch("cold-outreach", lead.id)).toMatchObject({ ok: true });
    await setOutboundPaused(true);
    expect((await statusOf()).mail).toMatchObject({ tone: "warn", summary: expect.stringMatching(/paused/) });
  });

  it("flags missing secrets and test-mode mail", async () => {
    const s = await statusOf({ VERCEL: "1", EMAIL_TRANSPORT: "outbox" });
    expect(s.replies).toMatchObject({ tone: "error", summary: expect.stringMatching(/EMAIL_INBOUND_SECRET isn't set/) });
    expect(s["daily-run"]).toMatchObject({ tone: "error", summary: expect.stringMatching(/CRON_SECRET isn't set/) });
    expect(s.yelp).toMatchObject({ tone: "warn" });
    expect(s.mail).toMatchObject({ tone: "warn", summary: expect.stringMatching(/Test mode/) });
  });

  it("warns when a job hasn't run for over a day", async () => {
    await prisma.pipelineRun.create({
      data: { pipeline: "all", kind: "stale-contacts", status: "succeeded", startedAt: new Date(Date.now() - 2 * DAY_MS), finishedAt: new Date() },
    });
    expect((await statusOf())["stale-contacts"]).toMatchObject({ tone: "warn", summary: expect.stringMatching(/over a day ago/) });
  });
});
