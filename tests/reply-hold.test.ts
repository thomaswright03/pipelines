// Round 10: only a confident reading of a reply acts by itself. A reply that
// needs a look holds every email to its address until the operator resolves
// it; confident opt-outs are still suppressed at once.
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { POST } from "@/app/api/email-inbound/route";
import { dismissReplyReviewAction, markOptedOutAction } from "@/lib/actions/outreach";
import { dismissReplyAction, optOutReplyAction } from "@/lib/actions/replies";
import { setAllowCrossPipelineRepeatsAction } from "@/lib/actions/settings";
import { previewBulkSend, sendFirstTouch } from "@/lib/outreach/send";
import { captureMail, makeAgentLead, makeColdLead } from "./helpers";

function inbound(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/email-inbound", {
      method: "POST",
      headers: { authorization: "Bearer test-inbound-secret", "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

let mail: ReturnType<typeof captureMail> | undefined;
afterEach(() => mail?.restore());

describe("interested replies that contain opt-out words (review finding 1)", () => {
  it.each([
    "Sure — but don't email me at this address, use jane@other.test instead.",
    "Please unsubscribe my old address and use this one going forward — send the pricing here.",
    "Stop! This is exactly what I need. Call me.",
    "Take me off the waitlist at my current vendor, I'd rather go with you. What's the price?",
  ])("%j is flagged for a look, not suppressed or moved to Lost", async (text) => {
    const lead = await makeColdLead({ email: "warm@shop.test", status: "contacted", lastEmailedAt: new Date() });
    const json = await (await inbound({ from: "warm@shop.test", text })).json();
    expect(json).toMatchObject({ optedOut: false, needsReview: [`cold-outreach:${lead.id}`] });
    expect(json.review).toMatch(/not to be emailed.*also/);
    expect(await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject({
      status: "contacted",
      replyNeedsReview: true,
      repliedAt: null,
    });
    expect(await prisma.suppressedEmail.count()).toBe(0);
  });

  it("reads past a corporate footer that mentions unsubscribing", async () => {
    const lead = await makeColdLead({ email: "footer@shop.test", status: "contacted", lastEmailedAt: new Date() });
    const text =
      "Interested! Can you call me Thursday?\n\nThis email and any attachments are confidential. If you received this in error, please notify the sender and delete it. To unsubscribe from our newsletter click here.";
    const json = await (await inbound({ from: "footer@shop.test", text })).json();
    expect(json).toMatchObject({ optedOut: false, review: null });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("responded");
    expect(await prisma.suppressedEmail.count()).toBe(0);
  });

  it.each(["STOP", "unsubscribe", "Remove me.", "Please stop emailing me. I am not interested in this at all."])(
    "still suppresses %j at once",
    async (text) => {
      const lead = await makeColdLead({ email: "done@shop.test", status: "contacted", lastEmailedAt: new Date() });
      const json = await (await inbound({ from: "done@shop.test", text })).json();
      expect(json.optedOut).toBe(true);
      expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("lost");
      expect(await prisma.suppressedEmail.findUnique({ where: { email: "done@shop.test" } })).not.toBeNull();
    },
  );
});

describe("polite and abbreviated opt-outs (review finding 2)", () => {
  it("never counts one as a positive reply, and the flag says it may be one", async () => {
    const lead = await makeColdLead({ email: "polite@shop.test", status: "contacted", lastEmailedAt: new Date() });
    await inbound({ from: "polite@shop.test", text: "I'd appreciate it if you didn't email me again." });
    const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after).toMatchObject({ status: "contacted", replyNeedsReview: true, repliedAt: null });
    expect(after.replyReviewReason).toMatch(/may be asking not to be emailed/);

    // The operator's resolution can make it an opt-out.
    expect(await markOptedOutAction("cold-outreach", lead.id)).toMatchObject({ ok: true });
    expect(await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject({ status: "lost", replyNeedsReview: false });
    expect(await prisma.suppressedEmail.findUnique({ where: { email: "polite@shop.test" } })).not.toBeNull();
  });
});

describe("a reply that needs a look holds email to the address", () => {
  it("sends nothing to a flagged lead, in a bulk send or by hand, until the operator resolves it", async () => {
    mail = captureMail();
    const agent = await makeAgentLead({ email: "maybe@realty.test", status: "new" });
    await inbound({ from: "maybe@realty.test", text: "Kindly exclude me from future mailings." });
    expect((await prisma.agentLead.findUniqueOrThrow({ where: { id: agent.id } })).replyNeedsReview).toBe(true);

    expect((await previewBulkSend("dataleadsell")).leadIds).not.toContain(agent.id);
    expect(await sendFirstTouch("dataleadsell", agent.id)).toMatchObject({ ok: false, reason: "reply_needs_look" });
    expect(mail.messages).toHaveLength(0);

    // The operator read it and decided it wasn't asking to stop.
    await dismissReplyReviewAction("dataleadsell", agent.id);
    expect(await sendFirstTouch("dataleadsell", agent.id)).toMatchObject({ ok: true });
    expect(mail.to()).toEqual(["maybe@realty.test"]);
  });

  it("holds a lead added later with the address of a flagged lead", async () => {
    mail = captureMail();
    const first = await makeColdLead({ email: "shared@shop.test", status: "contacted", lastEmailedAt: new Date() });
    await inbound({ from: "shared@shop.test", text: "Hmm." });
    const later = await makeAgentLead({ email: "shared@shop.test", status: "new" });
    await setAllowCrossPipelineRepeatsAction(true);

    const refused = await sendFirstTouch("dataleadsell", later.id);
    expect(refused).toMatchObject({ ok: false, reason: "reply_needs_look" });
    expect(refused.ok ? "" : refused.message).toContain(first.name);
    expect(mail.messages).toHaveLength(0);
  });

  it("holds an address whose unmatched reply needs a look until it is dismissed", async () => {
    mail = captureMail();
    await inbound({ from: "stranger@shop.test", text: "Please no further contact." });
    const reply = await prisma.inboundReply.findFirstOrThrow();
    expect(reply).toMatchObject({ optedOut: false, matched: [] });
    const lead = await makeColdLead({ email: "stranger@shop.test", status: "new" });

    expect(await sendFirstTouch("cold-outreach", lead.id)).toMatchObject({ ok: false, reason: "reply_needs_look" });
    await dismissReplyAction(reply.id);
    expect(await sendFirstTouch("cold-outreach", lead.id)).toMatchObject({ ok: true });
  });
});

describe("resolving an unmatched reply that needs a look", () => {
  it("can mark its address opted out, which suppresses it and clears it from the list", async () => {
    await inbound({ from: "gone@shop.test", text: "Pls rmv" });
    const reply = await prisma.inboundReply.findFirstOrThrow();
    expect(await optOutReplyAction(reply.id)).toMatchObject({ ok: true });
    expect(await prisma.suppressedEmail.findUnique({ where: { email: "gone@shop.test" } })).toMatchObject({ source: "manual" });
    expect(await prisma.inboundReply.findUniqueOrThrow({ where: { id: reply.id } })).toMatchObject({ resolution: "opted_out" });
    expect(await optOutReplyAction(reply.id)).toMatchObject({ ok: false });
  });
});

describe("a reply worded like an out-of-office (review finding 4)", () => {
  it("that also says yes is a reply that needs a look, not an automatic one", async () => {
    const lead = await makeColdLead({ email: "away@shop.test", status: "contacted", lastEmailedAt: new Date() });
    const json = await (
      await inbound({ from: "away@shop.test", text: "Yes I'm interested, I'm out of the office this week but call me Monday" })
    ).json();
    expect(json).toMatchObject({ kind: "reply", optedOut: false, needsReview: [`cold-outreach:${lead.id}`] });
    expect(json.review).toMatch(/out-of-office/);
  });

  it("is still automatic when it is one", async () => {
    const lead = await makeColdLead({ email: "ooo@shop.test", status: "contacted", lastEmailedAt: new Date() });
    const json = await (await inbound({ from: "ooo@shop.test", text: "I will be out until Monday with limited access to email." })).json();
    expect(json).toMatchObject({ kind: "auto_reply", needsReview: [] });
    expect(await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject({ status: "contacted", replyNeedsReview: false });
  });
});
