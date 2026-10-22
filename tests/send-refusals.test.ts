// Addresses the recipient's mail server refuses (e.g. "550 5.1.1 User
// unknown" for a guessed address): the lead is flagged with the reason and
// leaves the send queues, the address is never tried again, the refusal is
// not reported as the email service failing (bulk stop, daily run status,
// Settings → Connections), and every failed attempt leaves a trace on the
// lead.
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { MAX_TEMPORARY_REFUSALS, previewBulkSend, REFUSED_BLOCK_PREFIX, sendBulkChunk, sendFirstTouch } from "@/lib/outreach/send";
import { classifySendError } from "@/lib/send-email";
import { runBulkSend, bulkSendSummary } from "@/lib/bulk-send-run";
import { runDailyColdOutreach, DAILY_RUN_SOURCE } from "@/lib/vault-daily-run";
import { getConnectionStatus } from "@/lib/integration-status";
import { editLead } from "@/lib/outreach/lead-edit";
import { loadLeadContext } from "@/lib/lead-page";
import { captureMail, makeAgentLead, makeColdLead, recipientRefusal, seedNoneOf, smtpError, stubFetch } from "./helpers";

let mail: ReturnType<typeof captureMail>;
afterEach(() => mail?.restore());

async function bulkSendOnce(pipeline: "cold-outreach" | "dataleadsell") {
  const preview = await previewBulkSend(pipeline);
  const { progress, stopReason } = await runBulkSend(
    preview.leadIds,
    async (ids, consecutiveFailures) => ({ ok: true, result: await sendBulkChunk(pipeline, ids, { delayMs: 0, consecutiveFailures }) }),
    { shouldStop: () => false },
  );
  return { preview, progress, stopReason, ...bulkSendSummary(progress, stopReason, preview) };
}

describe("classifying a refusal", () => {
  it("a 5xx at RCPT TO is a permanent refusal of this recipient, not a service failure", () => {
    expect(classifySendError(recipientRefusal("x@y.test"))).toMatchObject({
      delivery: "not_sent",
      scope: "recipient",
      permanent: true,
      message: expect.stringContaining("User unknown"),
    });
  });
  it("a 4xx at RCPT TO is a temporary refusal of this recipient", () => {
    expect(classifySendError(recipientRefusal("x@y.test", 452))).toMatchObject({ scope: "recipient", permanent: false });
  });
  it("a mailbox status code at DATA is still about the recipient", () => {
    const err = smtpError("Message failed", {
      code: "EMESSAGE",
      command: "DATA",
      responseCode: 550,
      response: "550 5.1.1 mailbox unavailable",
    });
    expect(classifySendError(err)).toMatchObject({ scope: "recipient", permanent: true });
  });
  it("a refused message or sender is the service's problem", () => {
    const content = smtpError("Message failed", { code: "EMESSAGE", command: "DATA", responseCode: 554, response: "554 5.7.1 rejected" });
    expect(classifySendError(content)).toMatchObject({ scope: "service", delivery: "not_sent" });
    const sender = smtpError("Mail command failed", {
      code: "EENVELOPE",
      command: "MAIL FROM",
      responseCode: 553,
      response: "553 5.1.8 bad sender",
    });
    expect(classifySendError(sender)).toMatchObject({ scope: "service" });
  });
});

describe("a permanently refused address", () => {
  it("flags the lead with the reason, keeps the address claimed and leaves a trace", async () => {
    mail = captureMail();
    mail.refuse("gone@nowhere.test");
    const lead = await makeColdLead({ name: "Gone Shop", email: "gone@nowhere.test" });

    const outcome = await sendFirstTouch("cold-outreach", lead.id);
    expect(outcome).toMatchObject({ ok: false, reason: "address_refused", message: expect.stringMatching(/won't be emailed/) });

    const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id }, include: { activities: true } });
    expect(after.status).toBe("new");
    expect(after.sendBlockedReason).toMatch(new RegExp(`^${REFUSED_BLOCK_PREFIX}`));
    expect(after.lastSendFailedAt).not.toBeNull();
    expect(after.lastSendFailure).toMatch(/User unknown/);
    expect(after.activities).toEqual([
      expect.objectContaining({ type: "email", notes: expect.stringMatching(/^Send attempt failed: .*User unknown/) }),
    ]);
    expect(await prisma.outreachRecipient.findFirst({ where: { email: "gone@nowhere.test" } })).toMatchObject({ state: "refused" });

    // Never attempted again, from this lead or another with the same address.
    expect(await sendFirstTouch("cold-outreach", lead.id)).toMatchObject({ ok: false, reason: "blocked" });
    const agent = await makeAgentLead({ email: "gone@nowhere.test" });
    expect(await sendFirstTouch("dataleadsell", agent.id)).toMatchObject({ ok: false, reason: "address_refused" });
    expect((await prisma.agentLead.findUniqueOrThrow({ where: { id: agent.id } })).sendBlockedReason).toMatch(
      new RegExp(`^${REFUSED_BLOCK_PREFIX}`),
    );
    expect(mail.messages).toHaveLength(0);
  });

  it("doesn't mark the email service as not working", async () => {
    mail = captureMail();
    const good = await makeColdLead();
    expect((await sendFirstTouch("cold-outreach", good.id)).ok).toBe(true);
    mail.refuse("gone@nowhere.test");
    const bad = await makeColdLead({ email: "gone@nowhere.test" });
    expect(await sendFirstTouch("cold-outreach", bad.id)).toMatchObject({ reason: "address_refused" });

    const env = { VERCEL: "1", EMAIL_TRANSPORT: "zeptomail", ZEPTOMAIL_SMTP_PASSWORD: "test" };
    const mailRow = (await getConnectionStatus(env)).find((s) => s.key === "mail")!;
    expect(mailRow.tone).toBe("ok");

    // A real service failure still shows.
    mail.fail(smtpError("connect ECONNREFUSED", { code: "ESOCKET", syscall: "connect" }), 1);
    const third = await makeColdLead();
    expect(await sendFirstTouch("cold-outreach", third.id)).toMatchObject({ reason: "send_failed" });
    expect((await getConnectionStatus(env)).find((s) => s.key === "mail")!.tone).toBe("error");
  });

  it("can be replaced by editing the lead's address, which clears the flag", async () => {
    mail = captureMail();
    mail.refuse("typo@nowhere.test");
    const lead = await makeColdLead({ email: "typo@nowhere.test" });
    await sendFirstTouch("cold-outreach", lead.id);

    expect(await editLead("cold-outreach", lead.id, "right@nowhere.test", {})).toEqual({ ok: true });
    const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after).toMatchObject({ sendBlockedReason: null, lastSendFailure: null, sendRefusalCount: 0 });
    expect(await sendFirstTouch("cold-outreach", lead.id)).toMatchObject({ ok: true });
    expect(mail.to()).toEqual(["right@nowhere.test"]);
  });
});

describe("refused addresses don't jam the queues", () => {
  it("a bulk send reaches the good leads behind them and names the refusals; the next preview leaves them out", async () => {
    mail = captureMail();
    for (const n of [1, 2, 3]) {
      mail.refuse(`bad${n}@nowhere.test`);
      await makeColdLead({ name: `Bad ${n}`, email: `bad${n}@nowhere.test`, createdAt: new Date(Date.now() - (10 - n) * 60_000) });
    }
    await makeColdLead({ name: "Good 1", email: "good1@shop.test" });
    await makeColdLead({ name: "Good 2", email: "good2@shop.test" });

    const run = await bulkSendOnce("cold-outreach");
    expect(run.stopReason).toBeNull();
    expect(run.progress).toMatchObject({ sent: 2, refused: 3, failed: 0 });
    expect(mail.to().sort()).toEqual(["good1@shop.test", "good2@shop.test"]);
    expect(run.summary).toMatch(/3 addresses refused by the recipient's mail server/);
    expect(run.summary).not.toMatch(/email service/);
    expect(run.progress.messages.filter((m) => /^Bad \d: /.test(m))).toHaveLength(3);

    const next = await previewBulkSend("cold-outreach");
    expect(next.leadIds).toHaveLength(0);
  });

  it("the daily run skips them after the first refusal and isn't partial because of them", async () => {
    mail = captureMail();
    await seedNoneOf();
    stubFetch({});
    for (const n of [1, 2, 3]) {
      mail.refuse(`bad${n}@nowhere.test`);
      await makeColdLead({ email: `bad${n}@nowhere.test`, source: DAILY_RUN_SOURCE, createdAt: new Date(Date.now() - 60_000) });
    }
    await makeColdLead({ email: "good@shop.test", source: DAILY_RUN_SOURCE });

    const first = await runDailyColdOutreach(30, { sendDelayMs: 0 });
    expect(first.status).toBe("succeeded");
    expect(first.numbers?.emailsSent).toBe(1);
    expect(first.summary).toMatch(/3 addresses refused by the recipient's mail server/);

    const attemptsBefore = await prisma.leadActivity.count();
    const second = await runDailyColdOutreach(30, { sendDelayMs: 0 });
    expect(second.status).toBe("succeeded");
    expect(second.summary).not.toMatch(/refused/);
    expect(await prisma.leadActivity.count()).toBe(attemptsBefore);
  });

  it("a service failure still stops a bulk send after three in a row", async () => {
    mail = captureMail();
    mail.fail(smtpError("Connection timeout", { code: "ETIMEDOUT" }));
    await Promise.all([1, 2, 3, 4].map(() => makeColdLead()));
    const run = await bulkSendOnce("cold-outreach");
    expect(run.progress).toMatchObject({ failed: 3, refused: 0 });
    expect(run.stopReason).toMatch(/email service failed three times/);
  });
});

describe("a temporarily refused address", () => {
  it(`is retried, then treated as refused after ${MAX_TEMPORARY_REFUSALS} tries`, async () => {
    mail = captureMail();
    mail.refuse("full@inbox.test", recipientRefusal("full@inbox.test", 452));
    const lead = await makeColdLead({ email: "full@inbox.test" });

    for (let attempt = 1; attempt < MAX_TEMPORARY_REFUSALS; attempt++) {
      const outcome = await sendFirstTouch("cold-outreach", lead.id);
      expect(outcome).toMatchObject({
        reason: "address_refused",
        message: expect.stringContaining(`${attempt} of ${MAX_TEMPORARY_REFUSALS}`),
      });
      const row = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
      expect(row).toMatchObject({ status: "new", sendBlockedReason: null, sendRefusalCount: attempt });
      expect(await prisma.outreachRecipient.count()).toBe(0);
    }
    expect(await sendFirstTouch("cold-outreach", lead.id)).toMatchObject({ reason: "address_refused" });
    const row = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id }, include: { activities: true } });
    expect(row.sendBlockedReason).toMatch(/turned away 3 times/);
    expect(row.activities).toHaveLength(MAX_TEMPORARY_REFUSALS);
  });

  it("a later successful send clears the failure marker", async () => {
    mail = captureMail();
    mail.refuse("full@inbox.test", recipientRefusal("full@inbox.test", 451));
    const lead = await makeColdLead({ email: "full@inbox.test" });
    await sendFirstTouch("cold-outreach", lead.id);
    mail.accept("full@inbox.test");
    expect((await sendFirstTouch("cold-outreach", lead.id)).ok).toBe(true);
    expect(await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject({
      lastSendFailedAt: null,
      lastSendFailure: null,
      sendRefusalCount: 0,
    });
  });
});

describe("every failed attempt leaves a trace on the lead", () => {
  it("an unreachable service adds a History entry and the list marker", async () => {
    mail = captureMail();
    mail.fail(smtpError("connect ECONNREFUSED", { code: "ESOCKET", syscall: "connect" }), 1);
    const lead = await makeAgentLead();
    await sendFirstTouch("dataleadsell", lead.id);
    const after = await prisma.agentLead.findUniqueOrThrow({ where: { id: lead.id }, include: { activities: true } });
    expect(after.lastSendFailure).toMatch(/Couldn't reach the email service/);
    expect(after.activities[0]?.notes).toMatch(/^Send attempt failed: Couldn't reach/);
  });

  it("a dropped connection (delivery unknown) is recorded too", async () => {
    mail = captureMail();
    mail.fail(smtpError("Connection closed unexpectedly", { code: "ECONNECTION" }), 1);
    const lead = await makeColdLead();
    await sendFirstTouch("cold-outreach", lead.id);
    const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id }, include: { activities: true } });
    expect(after.status).toBe("contacted");
    expect(after.activities).toHaveLength(1);
  });
});

describe("the lead page's note about the send ledger", () => {
  it("calls a fresh claim a send in progress, and only an old one unfinished", async () => {
    const lead = await makeColdLead({ email: "busy@x.test", status: "contacted" });
    const claimedAt = new Date();
    await prisma.outreachRecipient.create({ data: { pipeline: "cold-outreach", email: "busy@x.test", leadId: lead.id, claimedAt } });

    const fresh = await loadLeadContext("cold-outreach", lead.id, "busy@x.test", new Date(claimedAt.getTime() + 10_000));
    expect(fresh.ledgerNote).toMatchObject({ tone: "info", text: expect.stringMatching(/still in progress/) });
    const stale = await loadLeadContext("cold-outreach", lead.id, "busy@x.test", new Date(claimedAt.getTime() + 10 * 60_000));
    expect(stale.ledgerNote).toMatchObject({ tone: "warning", text: expect.stringMatching(/never finished recording/) });
  });
});
