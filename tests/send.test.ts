import { afterEach, describe, expect, it, onTestFinished } from "vitest";
import { prisma } from "@/lib/db";
import { countReadyToEmail, previewBulkSend, sendBulkChunk, sendFirstTouch } from "@/lib/outreach/send";
import { getPipeline } from "@/lib/outreach/pipelines";
import { setAllowCrossPipelineRepeats, setOutboundPaused } from "@/lib/outreach/settings";
import { suppressEmail } from "@/lib/email-suppression";
import { sendOutreachEmailAction } from "@/lib/actions/outreach";
import { captureMail, makeAgentLead, makeColdLead, makeHaulerLead, smtpError } from "./helpers";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { vi } from "vitest";
import { sendOutreachEmail } from "@/lib/send-email";
import { handleInboundReply } from "@/lib/outreach/inbound";

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

describe("unsubscribe and reply headers", () => {
  it("every pitch names the reply inbox as Reply-To and carries a List-Unsubscribe mailto", async () => {
    mail = captureMail();
    const lead = await makeAgentLead({ email: "agent@realty.test" });
    await sendFirstTouch("dataleadsell", lead.id);
    const [message] = mail.messages;
    expect(message!.replyTo).toBe(message!.from);
    expect(message!.headers).toEqual({ "List-Unsubscribe": `<mailto:${message!.from}?subject=unsubscribe>` });
  });

  it("writes both headers into the .eml the local outbox keeps", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "outbox-"));
    vi.stubEnv("EMAIL_TRANSPORT", "outbox");
    vi.stubEnv("OUTBOX_DIR", dir);
    try {
      await sendOutreachEmail("thomas@wright-ai-solutions.com", "owner@acme.test", "Hello", "Body");
      const [file] = await readdir(dir);
      // Long headers are folded onto continuation lines (RFC 5322); unfold them.
      const eml = (await readFile(path.join(dir, file!), "utf8")).replace(/\r?\n[ \t]+/g, " ");
      expect(eml).toMatch(/^Reply-To: thomas@wright-ai-solutions\.com$/m);
      expect(eml).toMatch(/^List-Unsubscribe: <mailto:thomas@wright-ai-solutions\.com\?subject=unsubscribe>$/m);
    } finally {
      vi.unstubAllEnvs();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("the email a mail client's unsubscribe button sends is recorded as an opt-out", async () => {
    const lead = await makeColdLead({ email: "owner@acme.test", status: "contacted", lastEmailedAt: new Date() });
    const result = await handleInboundReply({
      from: "owner@acme.test",
      subject: "unsubscribe",
      text: "This message was automatically generated by Gmail.",
    });
    expect(result).toMatchObject({ optedOut: true, trigger: "Subject: unsubscribe" });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("lost");
    expect(await prisma.suppressedEmail.findUnique({ where: { email: "owner@acme.test" } })).not.toBeNull();
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
    const chunk = await sendBulkChunk(
      "cold-outreach",
      leads.map((l) => l.id),
      { delayMs: 0 },
    );
    expect(chunk).toMatchObject({ sent: 1, processedIds: [leads[0]!.id] });
    expect(mail.messages).toHaveLength(1);
  });
});

describe("the ready-to-email count", () => {
  /** One lead (or reply, or ledger row) for every reason a send skips an address, in all three pipelines. */
  async function seedEveryReason() {
    // Sendable, and two leads sharing one address (emailed once).
    await makeColdLead({ email: "ok@shop.test" });
    await makeColdLead({ email: "shared@shop.test" });
    await makeColdLead({ email: "shared@shop.test" });
    // A mixed-case address whose lower-case form opted out.
    await makeColdLead({ email: "Mixed@Shop.test" });
    await suppressEmail("mixed@shop.test", { reason: "test", source: "manual" });
    // On the do-not-email list.
    await makeColdLead({ email: "stop@shop.test" });
    await suppressEmail("stop@shop.test", { reason: "test", source: "manual" });
    // Pitched by another pipeline (counts only while cross-pipeline repeats are off), by this one, refused earlier.
    await makeColdLead({ email: "agent-pitched@shop.test" });
    await prisma.outreachRecipient.create({ data: { pipeline: "dataleadsell", email: "agent-pitched@shop.test", state: "sent" } });
    await makeColdLead({ email: "pitched@shop.test" });
    await prisma.outreachRecipient.create({ data: { pipeline: "cold-outreach", email: "pitched@shop.test", state: "sent" } });
    await makeColdLead({ email: "refused@shop.test" });
    await prisma.outreachRecipient.create({ data: { pipeline: "cold-outreach", email: "refused@shop.test", state: "refused" } });
    // A reply that needs a look on another pipeline's lead, or unmatched on the Replies page (and one resolved).
    await makeColdLead({ email: "flagged@shop.test" });
    await makeAgentLead({ email: "flagged@shop.test", status: "contacted", replyNeedsReview: true });
    await makeColdLead({ email: "unmatched@shop.test" });
    await prisma.inboundReply.create({
      data: { dedupeKey: "u1", fromEmail: "unmatched@shop.test", optedOut: false, matched: [], reviewReason: "Unclear." },
    });
    await makeColdLead({ email: "resolved@shop.test" });
    await prisma.inboundReply.create({
      data: {
        dedupeKey: "u2",
        fromEmail: "resolved@shop.test",
        optedOut: false,
        matched: [],
        reviewReason: "Unclear.",
        resolvedAt: new Date(),
      },
    });
    // Already answered with a plain no (and one whose answer was dismissed).
    await makeColdLead({ email: "no@shop.test" });
    await prisma.inboundReply.create({
      data: { dedupeKey: "a1", fromEmail: "no@shop.test", optedOut: false, matched: [], verdict: "declined" },
    });
    await makeColdLead({ email: "dismissed@shop.test" });
    await prisma.inboundReply.create({
      data: {
        dedupeKey: "a2",
        fromEmail: "dismissed@shop.test",
        optedOut: false,
        matched: [],
        verdict: "acknowledged",
        resolution: "dismissed",
      },
    });
    // Not New-with-an-address-and-not-held-back at all.
    await makeColdLead({ email: "blocked@shop.test", sendBlockedReason: "Duplicate address — test" });
    await makeColdLead({ email: "look@shop.test", replyNeedsReview: true });
    await makeColdLead({ email: "done@shop.test", status: "contacted" });
    await makeColdLead({ email: null });
    // dataleadsell: one sendable, one the Cold Outreach ledger holds.
    await makeAgentLead({ email: "agent@realty.test" });
    await makeAgentLead({ email: "pitched@shop.test" });
    // Garbage AI: one sendable, one in Mountain High's area, and an address shared by an excluded and an allowed hauler.
    await makeHaulerLead({ email: "office@desert.test", city: "Phoenix", state: "AZ" });
    await makeHaulerLead({ email: "office@frontrange.test", city: "Denver", state: "CO" });
    await makeHaulerLead({ email: "office@both.test", city: "Greeley", state: "CO" });
    await makeHaulerLead({ email: "office@both.test", city: "Mesa", state: "AZ" });
  }

  it("is exactly what a bulk send would email, in every pipeline and with either cross-pipeline setting", async () => {
    await seedEveryReason();
    const expected = {
      "cold-outreach": [
        { readyToEmail: 4, newWithAddress: 13 }, // ok, shared, resolved, dismissed
        { readyToEmail: 5, newWithAddress: 13 }, // + agent-pitched
      ],
      dataleadsell: [
        { readyToEmail: 1, newWithAddress: 2 },
        { readyToEmail: 2, newWithAddress: 2 }, // pitched@ was pitched by Cold Outreach
      ],
      "garbage-ai": [
        { readyToEmail: 2, newWithAddress: 4 },
        { readyToEmail: 2, newWithAddress: 4 },
      ],
    } as const;
    for (const [index, allow] of [false, true].entries()) {
      await setAllowCrossPipelineRepeats(allow);
      for (const pipeline of ["cold-outreach", "dataleadsell", "garbage-ai"] as const) {
        const count = await countReadyToEmail(pipeline);
        const preview = await previewBulkSend(pipeline);
        expect(count, `${pipeline}, repeats ${allow ? "allowed" : "off"}`).toEqual(expected[pipeline][index]);
        expect(count).toEqual({ readyToEmail: preview.willSend, newWithAddress: preview.totalEligible });
      }
    }
  });

  it("takes a fixed number of queries however many leads there are", async () => {
    await prisma.$executeRawUnsafe(`
      INSERT INTO "Lead" (id, name, email, status, "createdAt", "updatedAt")
      SELECT 'bulk-' || n, 'Bulk ' || n, 'bulk' || n || '@shop.test', 'new', now(), now() FROM generate_series(1, 3000) n`);
    await prisma.outreachRecipient.create({ data: { pipeline: "cold-outreach", email: "bulk1@shop.test", state: "sent" } });
    const listSendable = vi.spyOn(getPipeline("cold-outreach"), "listSendable");
    const queryRaw = prisma.$queryRaw.bind(prisma);
    const queries = vi
      .spyOn(prisma, "$queryRaw")
      .mockImplementation(((...args: Parameters<typeof queryRaw>) => queryRaw(...args)) as typeof prisma.$queryRaw);
    onTestFinished(() => {
      listSendable.mockRestore();
      queries.mockRestore();
    });
    expect(await countReadyToEmail("cold-outreach")).toEqual({ readyToEmail: 2999, newWithAddress: 3000 });
    expect(listSendable).not.toHaveBeenCalled();
    expect(queries).toHaveBeenCalledTimes(1);
  });
});
