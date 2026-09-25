import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { previewBulkSend, sendBulkChunk, sendFirstTouch } from "@/lib/outreach/send";
import { setAllowCrossPipelineRepeats, setOutboundPaused } from "@/lib/outreach/settings";
import { suppressEmail } from "@/lib/email-suppression";
import { sendOutreachEmailAction } from "@/lib/actions/outreach";
import { captureMail, makeAgentLead, makeColdLead, smtpError } from "./helpers";

let mail: ReturnType<typeof captureMail>;
afterEach(() => mail?.restore());

async function bulkSendAll(pipeline: "cold-outreach" | "dataleadsell") {
  const preview = await previewBulkSend(pipeline);
  let ids = preview.leadIds;
  let sent = 0;
  while (ids.length) {
    const chunk = await sendBulkChunk(pipeline, ids, { delayMs: 0 });
    sent += chunk.sent;
    ids = ids.filter((id) => !chunk.processedIds.includes(id));
    if (chunk.stop || chunk.processedIds.length === 0) break;
  }
  return sent;
}

describe("first-touch send", () => {
  it("sends once to a new lead, moves it to contacted and records the send", async () => {
    mail = captureMail();
    const lead = await makeColdLead({ email: "owner@acme.test" });

    const outcome = await sendFirstTouch("cold-outreach", lead.id);

    expect(outcome.ok).toBe(true);
    expect(mail.to()).toEqual(["owner@acme.test"]);
    const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id }, include: { emailLogs: true } });
    expect(after.status).toBe("contacted");
    expect(after.emailLogs).toHaveLength(1);
    expect(await prisma.outreachRecipient.findFirst({ where: { email: "owner@acme.test" } })).toMatchObject({
      state: "sent",
      pipeline: "cold-outreach",
    });
  });

  it.each(["contacted", "responded", "paying_client", "lost", "cold_call_list"])(
    "refuses a %s lead with a reason and sends nothing",
    async (status) => {
      mail = captureMail();
      const lead = await makeColdLead({ status });
      const outcome = await sendFirstTouch("cold-outreach", lead.id);
      expect(outcome).toMatchObject({ ok: false, reason: "not_new" });
      expect(mail.messages).toHaveLength(0);
    },
  );

  it("refuses through the server action too, with the reason in plain words", async () => {
    mail = captureMail();
    const lead = await makeAgentLead({ status: "subscribed", name: "Pat Paying" });
    const result = await sendOutreachEmailAction("dataleadsell", lead.id);
    expect(result).toEqual({
      ok: false,
      error: "Pat Paying is Subscribed, not New — the first pitch only goes to New leads. Nothing was sent.",
    });
    expect(mail.messages).toHaveLength(0);
  });

  it("never emails a suppressed address, and flags the lead", async () => {
    mail = captureMail();
    const lead = await makeColdLead({ email: "stop@acme.test" });
    await suppressEmail("STOP@acme.test", { reason: "test", source: "manual" });
    const outcome = await sendFirstTouch("cold-outreach", lead.id);
    expect(outcome).toMatchObject({ ok: false, reason: "suppressed" });
    expect(mail.messages).toHaveLength(0);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).sendBlockedReason).toMatch(/^Opted out/);
  });

  it("refuses everything while outbound email is paused", async () => {
    mail = captureMail();
    await setOutboundPaused(true);
    const lead = await makeColdLead();
    const agent = await makeAgentLead();
    expect(await sendFirstTouch("cold-outreach", lead.id)).toMatchObject({ ok: false, reason: "paused" });
    expect(await sendFirstTouch("dataleadsell", agent.id)).toMatchObject({ ok: false, reason: "paused" });
    const chunk = await sendBulkChunk("cold-outreach", [lead.id], { delayMs: 0 });
    expect(chunk.stop).toBe("paused");
    expect(mail.messages).toHaveLength(0);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("new");
  });
});

describe("one pitch per address", () => {
  it("sends one message per distinct address in a bulk send, flagging the rest (case-insensitive)", async () => {
    mail = captureMail();
    const agents = await Promise.all(
      ["Ann Agent", "Ben Agent", "Cal Agent"].map((name) => makeAgentLead({ name, email: "frontdesk@kellerwilliams.test" })),
    );
    await makeColdLead({ name: "Omega Bakery", email: "hello@omegabakery.test" });
    await makeColdLead({ name: "Omega Bakery (2nd listing)", email: "Hello@OmegaBakery.test".toLowerCase() });

    expect(await bulkSendAll("dataleadsell")).toBe(1);
    expect(await bulkSendAll("cold-outreach")).toBe(1);

    expect(mail.to().sort()).toEqual(["frontdesk@kellerwilliams.test", "hello@omegabakery.test"]);
    const flagged = await prisma.agentLead.findMany({ where: { id: { in: agents.map((a) => a.id) }, sendBlockedReason: { not: null } } });
    expect(flagged).toHaveLength(2);

    // A second bulk run finds nothing left to send.
    expect(await bulkSendAll("dataleadsell")).toBe(0);
    expect(mail.messages).toHaveLength(2);
  });

  it("blocks cross-pipeline repeats unless the owner allows them", async () => {
    mail = captureMail();
    const cold = await makeColdLead({ email: "shared@both.test" });
    const agent = await makeAgentLead({ email: "shared@both.test" });
    expect((await sendFirstTouch("cold-outreach", cold.id)).ok).toBe(true);
    expect(await sendFirstTouch("dataleadsell", agent.id)).toMatchObject({ ok: false, reason: "duplicate_address" });

    await setAllowCrossPipelineRepeats(true);
    const agent2 = await makeAgentLead({ email: "shared2@both.test" });
    const cold2 = await makeColdLead({ email: "shared2@both.test" });
    expect((await sendFirstTouch("dataleadsell", agent2.id)).ok).toBe(true);
    expect((await sendFirstTouch("cold-outreach", cold2.id)).ok).toBe(true);
    expect(mail.to()).toEqual(["shared@both.test", "shared2@both.test", "shared2@both.test"]);
  });

  it("previews counts, distinct addresses and a sample before sending anything", async () => {
    mail = captureMail();
    await makeColdLead({ name: "A", email: "a@x.test" });
    await makeColdLead({ name: "B", email: "b@x.test" });
    await makeColdLead({ name: "B again", email: "b@x.test" });
    await makeColdLead({ name: "Opted", email: "o@x.test" });
    await suppressEmail("o@x.test", { reason: "t", source: "manual" });

    const preview = await previewBulkSend("cold-outreach");
    expect(preview).toMatchObject({
      paused: false,
      totalEligible: 4,
      willSend: 2,
      distinctAddresses: 2,
      skipped: { duplicateInBatch: 1, alreadyPitched: 0, suppressed: 1 },
    });
    expect(preview.sample.map((s) => s.email)).toEqual(["a@x.test", "b@x.test"]);
    expect(mail.messages).toHaveLength(0);
  });
});

describe("concurrency and crash safety", () => {
  it("two bulk sends fired at once email each lead exactly once", async () => {
    mail = captureMail({ delayMs: 30 });
    const leads = await Promise.all([1, 2, 3, 4].map((i) => makeColdLead({ email: `lead${i}@race.test` })));
    const ids = leads.map((l) => l.id);

    const [a, b] = await Promise.all([
      sendBulkChunk("cold-outreach", ids, { delayMs: 0, chunkSize: 10 }),
      sendBulkChunk("cold-outreach", ids, { delayMs: 0, chunkSize: 10 }),
    ]);

    expect(a.sent + b.sent).toBe(4);
    expect(mail.to().sort()).toEqual(["lead1@race.test", "lead2@race.test", "lead3@race.test", "lead4@race.test"]);
    expect(await prisma.leadEmailSendLog.count()).toBe(4);
  });

  it("a cron-style send and a manual click on the same lead send once", async () => {
    mail = captureMail({ delayMs: 30 });
    const lead = await makeColdLead();
    const results = await Promise.all([sendFirstTouch("cold-outreach", lead.id), sendFirstTouch("cold-outreach", lead.id)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(mail.messages).toHaveLength(1);
  });

  it("the same lead sent from two tabs at once: one email, and the loser isn't flagged as a duplicate address", async () => {
    mail = captureMail({ delayMs: 30 });
    const lead = await makeColdLead({ name: "Bob's Bakery", email: "bob@bakery.test" });
    const results = await Promise.all([sendFirstTouch("cold-outreach", lead.id), sendFirstTouch("cold-outreach", lead.id)]);

    expect(mail.messages).toHaveLength(1);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({
      reason: "not_new",
      message: "Bob's Bakery was just emailed from another tab or send — nothing more was sent.",
    });
    expect(await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject({ status: "contacted", sendBlockedReason: null });
  });

  it("a crash after the claim (before recording) never leads to a second send", async () => {
    mail = captureMail();
    const lead = await makeColdLead({ email: "crash@x.test" });
    // Simulate a function killed mid-send: the claim transaction committed,
    // nothing after it ran.
    await prisma.$transaction([
      prisma.lead.update({ where: { id: lead.id }, data: { status: "contacted", lastEmailedAt: new Date() } }),
      prisma.outreachRecipient.create({ data: { pipeline: "cold-outreach", email: "crash@x.test", leadId: lead.id } }),
    ]);
    // Even if someone moved the lead back to new by hand:
    await prisma.lead.update({ where: { id: lead.id }, data: { status: "new" } });

    expect(await sendFirstTouch("cold-outreach", lead.id)).toMatchObject({ ok: false, reason: "duplicate_address" });
    expect(mail.messages).toHaveLength(0);
  });
});

describe("SMTP failures", () => {
  it("an unreachable email service releases the lead so it can be retried, with a plain message", async () => {
    mail = captureMail();
    mail.fail(smtpError("connect ECONNREFUSED 127.0.0.1:587", { code: "ESOCKET", syscall: "connect" }), 1);
    const lead = await makeColdLead({ email: "retry@x.test" });

    const first = await sendFirstTouch("cold-outreach", lead.id);
    expect(first).toMatchObject({
      ok: false,
      reason: "send_failed",
      message: "Couldn't reach the email service — nothing was sent. Try again in a few minutes.",
    });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("new");
    expect(await prisma.outreachRecipient.count()).toBe(0);

    expect((await sendFirstTouch("cold-outreach", lead.id)).ok).toBe(true);
    expect(mail.to()).toEqual(["retry@x.test"]);
  });

  it("a connection dropped mid-send keeps the claim so the lead is never re-pitched", async () => {
    mail = captureMail();
    mail.fail(smtpError("Connection closed unexpectedly", { code: "ECONNECTION" }), 1);
    const lead = await makeAgentLead({ email: "maybe@x.test" });

    expect(await sendFirstTouch("dataleadsell", lead.id)).toMatchObject({ ok: false, reason: "delivery_unknown" });
    expect((await prisma.agentLead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("contacted");
    expect(await prisma.outreachRecipient.findFirst()).toMatchObject({ state: "unknown" });
    expect(await sendFirstTouch("dataleadsell", lead.id)).toMatchObject({ ok: false, reason: "not_new" });
    expect(mail.messages).toHaveLength(0);
  });

  it("a bulk send stops after three consecutive failures, counted across its one-email calls", async () => {
    mail = captureMail();
    mail.fail(smtpError("Connection timeout", { code: "ETIMEDOUT" }));
    const leads = await Promise.all([1, 2, 3, 4, 5].map(() => makeColdLead()));
    let remaining = leads.map((l) => l.id);
    let consecutiveFailures = 0;
    let failed = 0;
    let stop: string | null = null;
    let calls = 0;
    while (remaining.length > 0 && !stop) {
      const chunk = await sendBulkChunk("cold-outreach", remaining, { delayMs: 0, consecutiveFailures });
      calls++;
      expect(chunk.processedIds.length).toBeLessThanOrEqual(1);
      consecutiveFailures = chunk.consecutiveFailures;
      failed += chunk.failed;
      stop = chunk.stop;
      remaining = remaining.filter((id) => !chunk.processedIds.includes(id));
    }
    expect({ failed, calls, stop }).toEqual({ failed: 3, calls: 3, stop: "email_service_down" });
    expect(await prisma.lead.count({ where: { status: "new" } })).toBe(5);
  });

  it("each bulk call sends at most one email, so Stop leaves at most one more", async () => {
    mail = captureMail();
    const leads = await Promise.all([1, 2, 3].map(() => makeColdLead()));
    const chunk = await sendBulkChunk("cold-outreach", leads.map((l) => l.id), { delayMs: 0 });
    expect(chunk).toMatchObject({ sent: 1, processedIds: [leads[0]!.id] });
    expect(mail.messages).toHaveLength(1);
  });
});
