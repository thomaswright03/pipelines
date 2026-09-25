// Automatic replies and bounce notices on the reply inbox: neither is a
// prospect replying, so neither may move a lead to Responded or count
// toward the reply rate.
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { POST } from "@/app/api/email-inbound/route";
import { detectAutoReply, detectBounce, headerValue } from "@/lib/outreach/auto-mail";
import { attachReplyToLead, listUnmatchedReplies } from "@/lib/outreach/inbound";
import { routeStaleContacts } from "@/lib/outreach/stale-contacts";
import { sendFirstTouch } from "@/lib/outreach/send";
import { getDataleadsellStats, getVaultStats } from "@/lib/pipeline-stats";
import { captureMail, makeAgentLead, makeColdLead } from "./helpers";

function inbound(body: Record<string, unknown>) {
  return POST(
    new NextRequest("http://localhost/api/email-inbound", {
      method: "POST",
      headers: { authorization: "Bearer test-inbound-secret", "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

let mail: ReturnType<typeof captureMail> | undefined;
afterEach(() => {
  mail?.restore();
  vi.useRealTimers();
});

const DAY_MS = 86_400_000;

describe("detectAutoReply", () => {
  it("reads the standard headers, in any case, and ignores Auto-Submitted: no", () => {
    expect(detectAutoReply({ headers: { "Auto-Submitted": "auto-replied" } })).toMatch(/Auto-Submitted: auto-replied/);
    expect(detectAutoReply({ headers: { "auto-submitted": "auto-generated" } })).toMatch(/auto-generated/);
    expect(detectAutoReply({ headers: { "Auto-Submitted": "no" }, subject: "Re: hello", text: "Sounds good" })).toBeNull();
    expect(detectAutoReply({ headers: { "X-Autoreply": "yes" } })).toMatch(/X-Autoreply/);
    expect(detectAutoReply({ headers: { "X-Autorespond": "1" } })).toMatch(/X-Autorespond/);
    expect(detectAutoReply({ headers: { Precedence: "auto_reply" } })).toMatch(/Precedence: auto_reply/);
    expect(detectAutoReply({ headers: { Precedence: "bulk" } })).toMatch(/bulk/);
    expect(detectAutoReply({ headers: { Precedence: "list" } })).toBeNull();
    expect(detectAutoReply({ headers: { "X-Auto-Response-Suppress": "All" } })).toMatch(/X-Auto-Response-Suppress/);
    expect(detectAutoReply({ headers: { "X-Auto-Response-Suppress": ["DR", "OOF"] } })).toMatch(/OOF/);
  });

  it("reads out-of-office subjects and wording", () => {
    for (const subject of [
      "Automatic reply: hello",
      "Auto-Reply: Quick question",
      "Out of Office: hi",
      "RE: Out of the office",
      "Autoreply",
      "Abwesenheitsnotiz: Hallo",
    ]) {
      expect(detectAutoReply({ subject, text: "" }), subject).not.toBeNull();
    }
    for (const text of [
      "I am out of the office until Monday.",
      "I am currently out of the office with limited access to email.",
      "I'm on vacation through 10/3 and will reply when I'm back.",
      "Thanks for your email. I'm away until Sept 30.",
      "This is an automated response. Thank you for contacting us, we will respond within 24 hours.",
    ]) {
      expect(detectAutoReply({ subject: "Re: hello", text }), text).not.toBeNull();
    }
  });

  it("leaves replies a person wrote alone", () => {
    for (const text of [
      "Yes, interested! Call me Monday.",
      "Not interested, thanks.",
      "I was out of town last week — can you send pricing?",
      "Thanks for reaching out. What does it cost?",
      "Who is this?",
      // A person could write this, so without an autoresponder header it counts as a reply.
      "Thank you for your message! We'll get back to you as soon as possible.",
    ]) {
      expect(detectAutoReply({ subject: "Re: hello", text }), text).toBeNull();
    }
  });

  it("finds a header whatever its case", () => {
    expect(headerValue({ "X-FOO": "a" }, "x-foo")).toBe("a");
    expect(headerValue({ "x-foo": ["a", "b"] }, "X-Foo")).toBe("a, b");
    expect(headerValue(null, "x-foo")).toBeNull();
  });
});

const POSTFIX_BOUNCE = {
  from: "MAILER-DAEMON@mx.davedeli.example (Mail Delivery System)",
  subject: "Undelivered Mail Returned to Sender",
  text: [
    "This is the mail system at host mx.davedeli.example.",
    "",
    "I'm sorry to have to inform you that your message could not",
    "be delivered to one or more recipients.",
    "",
    "<dave@davedeli.example>: host mx.davedeli.example said: 550 5.1.1 <dave@davedeli.example>: Recipient address rejected: User unknown",
  ].join("\n"),
};

describe("detectBounce", () => {
  it("reads Postfix, Gmail, Exchange and bare DSN notices, and the failed address", () => {
    expect(detectBounce(POSTFIX_BOUNCE)).toMatchObject({
      failedRecipient: "dave@davedeli.example",
      diagnostic: expect.stringMatching(/5\.1\.1/),
    });
    expect(
      detectBounce({
        from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
        subject: "Delivery Status Notification (Failure)",
        text: "Address not found\n\nYour message wasn't delivered to jane@shop.example because the address couldn't be found.\n\n550 5.1.1 The email account that you tried to reach does not exist.",
      }),
    ).toMatchObject({ failedRecipient: "jane@shop.example" });
    expect(
      detectBounce({
        from: "postmaster@outlook.com",
        subject: "Undeliverable: Quick question",
        text: "Delivery has failed to these recipients or groups:\n\nbob@corp.example\nThe email address you entered couldn't be found.\n\nDiagnostic information for administrators:\nRemote Server returned '550 5.1.10 RESOLVER.ADR.RecipientNotFound'",
      }),
    ).toMatchObject({ failedRecipient: "bob@corp.example" });
    expect(
      detectBounce({
        from: "bounces@relay.example",
        subject: "Returned mail",
        text: "Reporting-MTA: dns; relay.example\n\nFinal-Recipient: rfc822; sam@x.example\nAction: failed\nStatus: 5.2.2\nDiagnostic-Code: smtp; 552 5.2.2 Mailbox full",
      }),
    ).toMatchObject({ failedRecipient: "sam@x.example", diagnostic: "smtp; 552 5.2.2 Mailbox full" });
    expect(detectBounce({ from: "someone@corp.example", headers: { "X-Failed-Recipients": "lee@corp.example" }, text: "" })).toMatchObject({
      failedRecipient: "lee@corp.example",
    });
  });

  it("never takes our own sender address for the failed recipient", () => {
    const bounce = detectBounce(
      {
        from: "mailer-daemon@mx.example",
        subject: "failure notice",
        text: "From: thomas@wright-ai-solutions.com\nTo: pat@shop.example\n550 5.1.1 no such user",
      },
      ["wright-ai-solutions.com"],
    );
    expect(bounce?.failedRecipient).toBe("pat@shop.example");
  });

  it("doesn't treat a person mentioning a delivery problem as a bounce", () => {
    expect(
      detectBounce({
        from: "pat@shop.example",
        subject: "Re: hello",
        text: "Your email to my partner could not be delivered, try bob@shop.example",
      }),
    ).toBeNull();
    expect(detectBounce({ from: "pat@shop.example", subject: "Re: hello", text: "Interested!" })).toBeNull();
  });
});

describe("an automatic reply", () => {
  const AUTO_PAYLOADS = [
    { subject: "Automatic reply: hello", text: "I am out of the office until Monday." },
    { subject: "Re: Quick question", text: "Thanks for your note.", headers: { "Auto-Submitted": "auto-replied" } },
    { subject: "Re: Quick question", text: "I am currently out of the office with limited access to email." },
  ];

  it("is recorded in the lead's history and changes nothing else", async () => {
    for (const [i, payload] of AUTO_PAYLOADS.entries()) {
      const lead = await makeColdLead({ email: `ooo${i}@shop.example`, status: "contacted", lastEmailedAt: new Date() });
      await prisma.leadEmailSendLog.create({ data: { leadId: lead.id, email: lead.email! } });
      const json = await (await inbound({ from: lead.email!, ...payload })).json();

      expect(json).toMatchObject({ kind: "auto_reply", optedOut: false, review: null, matched: [`cold-outreach:${lead.id}`] });
      const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
      expect(after).toMatchObject({ status: "contacted", repliedAt: null, replyNeedsReview: false });
      const history = await prisma.leadActivity.findFirstOrThrow({ where: { leadId: lead.id } });
      expect(history.notes).toMatch(/^Automatic reply received/);
      expect(history.notes).toMatch(/status and reply time were left as they were/);
    }
    const stats = await getVaultStats();
    expect(stats).toMatchObject({ replied: 0, replyRate: 0, autoReplied: 3 });
    expect(await listUnmatchedReplies()).toHaveLength(0);
  });

  it("leaves the lead to move to the call deck after a week of silence", async () => {
    const lead = await makeAgentLead({
      email: "away@realty.example",
      phone: "+14805550100",
      status: "contacted",
      lastEmailedAt: new Date(Date.now() - 8 * DAY_MS),
    });
    await inbound({ from: "away@realty.example", subject: "Out of Office", text: "Away until Oct 5." });
    await routeStaleContacts();
    expect((await prisma.agentLead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("cold_call_list");
  });

  it("doesn't stop a real reply that follows from counting", async () => {
    const lead = await makeColdLead({ email: "later@shop.example", status: "contacted", lastEmailedAt: new Date() });
    await prisma.leadEmailSendLog.create({ data: { leadId: lead.id, email: lead.email! } });
    await inbound({ from: lead.email!, subject: "Automatic reply: hello", text: "I am out of the office until Monday." });
    await inbound({ from: lead.email!, subject: "Re: hello", text: "Back now — yes, tell me more." });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("responded");
    expect(await getVaultStats()).toMatchObject({ replied: 1, autoReplied: 1 });
  });

  it("still honours an opt-out, even from an autoresponder", async () => {
    const lead = await makeColdLead({ email: "bot@shop.example", status: "contacted", lastEmailedAt: new Date() });
    const json = await (
      await inbound({
        from: lead.email!,
        subject: "Automatic reply",
        text: "Please remove me from your list.",
        headers: { "Auto-Submitted": "auto-replied" },
      })
    ).json();
    expect(json).toMatchObject({ optedOut: true, kind: "reply" });
    expect(await prisma.suppressedEmail.count({ where: { email: lead.email! } })).toBe(1);
  });

  it("from an address no lead has is filed away, not listed for matching", async () => {
    await inbound({ from: "stranger@else.example", subject: "Automatic reply: hi", text: "I am out of the office." });
    expect(await listUnmatchedReplies()).toHaveLength(0);
    expect(await prisma.inboundReply.findFirstOrThrow()).toMatchObject({ kind: "auto_reply", resolution: "auto_reply" });
  });
});

describe("a bounce notice", () => {
  it("marks the recipient's send bounced, with the Mark bounced rules, and isn't listed as a reply", async () => {
    mail = captureMail();
    const lead = await makeColdLead({ email: "dave@davedeli.example" });
    expect(await sendFirstTouch("cold-outreach", lead.id)).toMatchObject({ ok: true });

    const json = await (await inbound(POSTFIX_BOUNCE)).json();

    expect(json).toMatchObject({ kind: "bounce", matched: [`cold-outreach:${lead.id}`], optedOut: false });
    expect(await prisma.leadEmailSendLog.findFirstOrThrow({ where: { leadId: lead.id } })).toMatchObject({ bounced: true });
    expect(await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject({ status: "lost", repliedAt: null });
    expect((await prisma.leadActivity.findFirstOrThrow({ where: { leadId: lead.id } })).notes).toMatch(/^Bounce notice received/);
    expect(await getVaultStats()).toMatchObject({ bounced: 1, replied: 0 });
    expect(await listUnmatchedReplies()).toHaveLength(0);
    expect(await prisma.suppressedEmail.count()).toBe(0);
  });

  it("that names no lead is listed as a bounce, and 'Mark bounced' applies it to the picked lead", async () => {
    mail = captureMail();
    const lead = await makeAgentLead({ email: "agent@realty.example" });
    await sendFirstTouch("dataleadsell", lead.id);
    await inbound({
      from: "mailer-daemon@mx.example",
      subject: "Delivery failure",
      text: "Your message could not be delivered.\n550 5.1.1 user unknown",
    });

    const [listed] = await listUnmatchedReplies();
    expect(listed).toMatchObject({ kind: "bounce", failedRecipient: null });

    const never = await makeAgentLead({ email: "never@realty.example" });
    expect(await attachReplyToLead(listed!.id, "dataleadsell", never.id)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/never emailed/),
    });

    expect(await attachReplyToLead(listed!.id, "dataleadsell", lead.id)).toEqual({
      ok: true,
      message: `Marked the email to ${lead.name} as bounced — moved to Lost.`,
    });
    expect(await prisma.emailSendLog.findFirstOrThrow({ where: { leadId: lead.id } })).toMatchObject({ bounced: true });
    expect(await getDataleadsellStats()).toMatchObject({ bounced: 1, replied: 0 });
    expect(await listUnmatchedReplies()).toHaveLength(0);
  });
});

describe("the Stats reply figures", () => {
  it("count only replies a person wrote; opt-outs and automatic replies are shown on their own", async () => {
    for (const pipeline of ["cold-outreach", "dataleadsell"] as const) {
      await prisma.$transaction([prisma.inboundReply.deleteMany(), prisma.suppressedEmail.deleteMany()]);
      mail = captureMail();
      const make = pipeline === "cold-outreach" ? makeColdLead : makeAgentLead;
      const [genuine, auto, stop] = [await make({}), await make({}), await make({})];
      for (const lead of [genuine, auto, stop]) expect(await sendFirstTouch(pipeline, lead.id)).toMatchObject({ ok: true });

      await inbound({ from: genuine.email!, subject: "Re: hi", text: "Yes, tell me more." });
      await inbound({ from: auto.email!, subject: "Automatic reply: hi", text: "I am out of the office until Monday." });
      await inbound({ from: stop.email!, subject: "Re: hi", text: "STOP" });

      const stats = pipeline === "cold-outreach" ? await getVaultStats() : await getDataleadsellStats();
      expect(stats, pipeline).toMatchObject({ leadsEmailed: 3, replied: 1, optedOut: 1, autoReplied: 1, weReplied: 0 });
      expect(stats.replyRate).toBeCloseTo(1 / 3);
      mail.restore();
    }
  });
});
