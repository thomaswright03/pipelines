// Replying from the Inbox: threads under the person's message, is logged on
// the lead, and never goes out while paused or to an opted-out address.
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { setOutboundPaused } from "@/lib/outreach/settings";
import { suppressEmail } from "@/lib/email-suppression";
import { replySubject, sendInboxReply } from "@/lib/outreach/reply-send";
import { getPipelineInbox } from "@/lib/outreach/inbox";
import { captureMail, makeAgentLead, makeColdLead, smtpError } from "./helpers";

let mail: ReturnType<typeof captureMail>;
afterEach(() => mail?.restore());

async function inboundFrom(lead: { id: string; email: string | null }, pipeline = "cold-outreach", data: Record<string, unknown> = {}) {
  return prisma.inboundReply.create({
    data: {
      dedupeKey: "mid:abc123@mail.example.test",
      fromEmail: lead.email!,
      subject: "Re: Quick question about your business",
      text: "Sure, what does it cost?",
      optedOut: false,
      matched: [`${pipeline}:${lead.id}`],
      verdict: "positive",
      ...data,
    },
  });
}

describe("sendInboxReply", () => {
  it("sends in the same thread from the pipeline's address and logs it on the lead", async () => {
    mail = captureMail();
    const lead = await makeColdLead({ name: "Acme Plumbing", status: "responded", repliedAt: new Date() });
    const inbound = await inboundFrom(lead);

    const result = await sendInboxReply("cold-outreach", inbound.id, "  Happy to explain. It starts at $500.  ");
    expect(result).toEqual({ ok: true, message: `Sent your reply to ${lead.email}.` });

    expect(mail.messages).toHaveLength(1);
    const m = mail.messages[0]!;
    expect(m.to).toBe(lead.email);
    expect(m.subject).toBe("Re: Quick question about your business");
    expect(m.text).toBe("Happy to explain. It starts at $500.");
    expect(m.replyTo).toBe(m.from);
    expect(m.headers).toMatchObject({ "In-Reply-To": "<abc123@mail.example.test>", References: "<abc123@mail.example.test>" });

    const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id }, include: { activities: true } });
    expect(after.ourReplyAt).not.toBeNull();
    expect(after.activities).toHaveLength(1);
    expect(after.activities[0]!.type).toBe("email");
    expect(after.activities[0]!.notes).toContain("It starts at $500.");
    // The pitch send log (and its stats) stays pitches only.
    expect(await prisma.leadEmailSendLog.count()).toBe(0);

    const inbox = await getPipelineInbox("cold-outreach", "replied");
    expect(inbox.replied[0]!.ourReplyAt).toEqual(after.ourReplyAt);
  });

  it("leaves out threading headers when the reply had no Message-ID", async () => {
    mail = captureMail();
    const lead = await makeAgentLead();
    const inbound = await inboundFrom(lead, "dataleadsell", { dedupeKey: "hash:deadbeef", subject: null });
    expect((await sendInboxReply("dataleadsell", inbound.id, "Thanks!")).ok).toBe(true);
    expect(mail.messages[0]!.subject).toBe("Re: your reply");
    expect(mail.messages[0]!.headers).not.toHaveProperty("In-Reply-To");
  });

  it("sends nothing while outbound email is paused", async () => {
    mail = captureMail();
    await setOutboundPaused(true);
    const lead = await makeColdLead();
    const inbound = await inboundFrom(lead);
    const result = await sendInboxReply("cold-outreach", inbound.id, "Hello");
    expect(result.ok).toBe(false);
    expect(mail.messages).toHaveLength(0);
  });

  it("sends nothing to an address on the do-not-email list", async () => {
    mail = captureMail();
    const lead = await makeColdLead();
    const inbound = await inboundFrom(lead);
    await suppressEmail(lead.email!, { reason: "asked", source: "manual" });
    const result = await sendInboxReply("cold-outreach", inbound.id, "Hello");
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("do-not-email list") });
    expect(mail.messages).toHaveLength(0);
    expect((await getPipelineInbox("cold-outreach", "replied")).replied[0]!.optedOut).toBe(true);
  });

  it("refuses an empty reply, another pipeline's reply, and automatic replies", async () => {
    mail = captureMail();
    const lead = await makeColdLead();
    const inbound = await inboundFrom(lead);
    expect((await sendInboxReply("cold-outreach", inbound.id, "   ")).ok).toBe(false);
    expect((await sendInboxReply("dataleadsell", inbound.id, "Hi")).ok).toBe(false);
    const auto = await inboundFrom(lead, "cold-outreach", { dedupeKey: "mid:auto", kind: "auto_reply", verdict: null });
    expect((await sendInboxReply("cold-outreach", auto.id, "Hi")).ok).toBe(false);
    expect(mail.messages).toHaveLength(0);
  });

  it("says why when the email service fails, and logs nothing on the lead", async () => {
    mail = captureMail();
    mail.fail(smtpError("Invalid login", { code: "EAUTH" }));
    const lead = await makeColdLead();
    const inbound = await inboundFrom(lead);
    const result = await sendInboxReply("cold-outreach", inbound.id, "Hello");
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("rejected our login") });
    expect(await prisma.leadActivity.count()).toBe(0);
  });

  it("doesn't stack Re: prefixes", () => {
    expect(replySubject("RE: Pricing")).toBe("RE: Pricing");
    expect(replySubject("Pricing")).toBe("Re: Pricing");
  });
});
