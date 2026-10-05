// Round 11: two more confident outcomes of the reply rules, so fewer replies
// need the operator. A plain no ("declined") closes a lead still being
// worked; a courtesy note ("acknowledged": "Thanks", "Got it") changes
// nothing on the lead. Neither is an opt-out or a positive reply, and both
// hold every further email to the address, as a reply that needs a look
// does — without asking anyone to look.
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { POST } from "@/app/api/email-inbound/route";
import { markRepliedAction, updateLeadStatusAction } from "@/lib/actions/outreach";
import { attachReplyAction, dismissReplyAction } from "@/lib/actions/replies";
import { setAllowCrossPipelineRepeatsAction } from "@/lib/actions/settings";
import { getQualitySignals } from "@/lib/outreach/corrections";
import { ANSWERED_BLOCK_PREFIX, previewBulkSend, sendBulkChunk, sendFirstTouch } from "@/lib/outreach/send";
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

describe("a courtesy reply (acknowledged)", () => {
  it.each(["Thanks!", "Got it, thank you.", "Received.", "Thanks for reaching out,\nJane"])(
    "%j is neither a reply nor a flag, and the lead stays where it is",
    async (text) => {
      const lead = await makeColdLead({ email: "thanks@shop.test", status: "contacted", lastEmailedAt: new Date() });
      const json = await (await inbound({ from: "thanks@shop.test", text })).json();
      expect(json).toMatchObject({ kind: "reply", verdict: "acknowledged", optedOut: false, review: null, needsReview: [] });
      expect(await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject({
        status: "contacted",
        repliedAt: null,
        replyNeedsReview: false,
      });
      expect(await prisma.suppressedEmail.count()).toBe(0);
      expect(await prisma.inboundReply.findFirstOrThrow()).toMatchObject({ verdict: "acknowledged" });
    },
  );

  it("holds a later send to the address from the other pipeline, as already answered", async () => {
    mail = captureMail();
    await makeColdLead({ email: "thanks@shop.test", status: "contacted", lastEmailedAt: new Date() });
    await inbound({ from: "thanks@shop.test", text: "Thanks" });
    await setAllowCrossPipelineRepeatsAction(true);
    const agent = await makeAgentLead({ email: "thanks@shop.test", status: "new" });

    const refused = await sendFirstTouch("dataleadsell", agent.id);
    expect(refused).toMatchObject({ ok: false, reason: "already_answered" });
    expect(refused.ok ? "" : refused.message).toMatch(/courtesy reply \(“Thanks”\)/);
    expect(mail.messages).toHaveLength(0);
    // The lead says so on its page, and bulk sends leave it out from now on.
    expect((await prisma.agentLead.findUniqueOrThrow({ where: { id: agent.id } })).sendBlockedReason).toMatch(
      new RegExp(`^${ANSWERED_BLOCK_PREFIX}`),
    );
  });

  it("marks a New lead with the same address as already answered at once", async () => {
    await makeColdLead({ email: "shared@shop.test", status: "contacted", lastEmailedAt: new Date() });
    const fresh = await makeColdLead({ email: "shared@shop.test", status: "new" });
    await inbound({ from: "shared@shop.test", text: "Got it" });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: fresh.id } })).sendBlockedReason).toMatch(
      new RegExp(`^${ANSWERED_BLOCK_PREFIX}`),
    );
  });

  it("counts as a correction when the operator marks the lead replied after all", async () => {
    const lead = await makeColdLead({ email: "warm@shop.test", status: "contacted", lastEmailedAt: new Date() });
    await inbound({ from: "warm@shop.test", text: "Thank you!" });
    expect(await markRepliedAction("cold-outreach", lead.id)).toMatchObject({ ok: true });
    const correction = await prisma.outreachCorrection.findFirstOrThrow();
    expect(correction).toMatchObject({ kind: "courtesy_was_reply", leadId: lead.id, detail: "Thank you!" });
    expect(correction.rulesVersion).toMatch(/^reply\.6-/);
    expect(await getQualitySignals()).toMatchObject({ acknowledged: 1, courtesyWasReply: 1 });
  });
});

describe("a plain no (declined)", () => {
  it("closes a Cold Outreach lead still being worked as Lost, without suppressing the address", async () => {
    const lead = await makeColdLead({ email: "no@shop.test", status: "contacted", lastEmailedAt: new Date() });
    const json = await (await inbound({ from: "no@shop.test", text: "Not interested, thanks." })).json();
    expect(json).toMatchObject({ verdict: "declined", optedOut: false, review: null, needsReview: [] });
    const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after).toMatchObject({ status: "lost", callOutcome: "not_interested", replyNeedsReview: false });
    expect(after.repliedAt).not.toBeNull();
    expect(await prisma.suppressedEmail.count()).toBe(0);
  });

  it("moves a dataleadsell agent to Not interested", async () => {
    const agent = await makeAgentLead({ email: "no@realty.test", status: "contacted", lastEmailedAt: new Date() });
    await inbound({ from: "no@realty.test", text: "No thanks." });
    expect((await prisma.agentLead.findUniqueOrThrow({ where: { id: agent.id } })).status).toBe("not_interested");
  });

  it("flags a lead that got further (Responded) instead of closing it", async () => {
    const lead = await makeColdLead({ email: "later@shop.test", status: "responded", lastEmailedAt: new Date(), repliedAt: new Date() });
    await inbound({ from: "later@shop.test", text: "We're not interested." });
    const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after).toMatchObject({ status: "responded", replyNeedsReview: true });
    expect(after.replyReviewReason).toMatch(/check whether to close it/);
  });

  it("can be reversed: moving the lead back to Responded is counted", async () => {
    const lead = await makeColdLead({ email: "oops@shop.test", status: "contacted", lastEmailedAt: new Date() });
    await inbound({ from: "oops@shop.test", text: "No." });
    expect(await updateLeadStatusAction("cold-outreach", lead.id, "responded")).toMatchObject({ ok: true });
    expect(await prisma.outreachCorrection.findFirstOrThrow()).toMatchObject({ kind: "decline_reversed", leadId: lead.id });
    expect(await getQualitySignals()).toMatchObject({ declined: 1, declinesReversed: 1 });
  });

  it("is never sent another email, in either pipeline", async () => {
    mail = captureMail();
    await makeAgentLead({ email: "never@shop.test", status: "contacted", lastEmailedAt: new Date() });
    await inbound({ from: "never@shop.test", text: "Not for us." });
    await setAllowCrossPipelineRepeatsAction(true);
    const lead = await makeColdLead({ email: "never@shop.test", status: "new" });
    expect(await sendFirstTouch("cold-outreach", lead.id)).toMatchObject({ ok: false, reason: "already_answered" });
    expect(mail.messages).toHaveLength(0);
  });
});

describe("an unmatched courtesy note or plain no", () => {
  it("holds the address until it is dismissed from the Replies page", async () => {
    mail = captureMail();
    await inbound({ from: "stranger@shop.test", text: "Thanks, got it." });
    const reply = await prisma.inboundReply.findFirstOrThrow();
    expect(reply).toMatchObject({ verdict: "acknowledged", matched: [], reviewReason: null });
    const lead = await makeColdLead({ email: "stranger@shop.test", status: "new" });

    expect(await sendFirstTouch("cold-outreach", lead.id)).toMatchObject({ ok: false, reason: "already_answered" });
    expect(await dismissReplyAction(reply.id)).toMatchObject({ ok: true });
    // The block the refusal put on the lead is about the address; the operator lifts it by editing or confirming.
    await prisma.lead.update({ where: { id: lead.id }, data: { sendBlockedReason: null } });
    expect(await sendFirstTouch("cold-outreach", lead.id)).toMatchObject({ ok: true });
    expect(mail.to()).toEqual(["stranger@shop.test"]);
  });

  it("attaching a plain no to the lead it came from closes that lead", async () => {
    const lead = await makeColdLead({ email: "owner@shop.test", status: "contacted", lastEmailedAt: new Date() });
    await inbound({ from: "assistant@shop.test", text: "Not interested." });
    const reply = await prisma.inboundReply.findFirstOrThrow();
    expect(await attachReplyAction(reply.id, "cold-outreach", lead.id)).toMatchObject({ ok: true });
    expect(await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject({ status: "lost", replyNeedsReview: false });
    expect(await prisma.suppressedEmail.count()).toBe(0);
  });
});

describe("the bulk preview counts every skip under the reason the send gives", () => {
  it("matches what the run then does, lead by lead", async () => {
    mail = captureMail();
    // Replies on earlier leads in the other pipeline, one of each kind.
    for (const [email, text] of [
      ["look@a.test", "Hmm."],
      ["thanks@a.test", "Thanks!"],
      ["no@a.test", "No thanks"],
    ]) {
      await makeColdLead({ email, status: "contacted", lastEmailedAt: new Date() });
      await inbound({ from: email, text });
    }
    await setAllowCrossPipelineRepeatsAction(true);
    await prisma.suppressedEmail.create({ data: { email: "gone@a.test", source: "manual" } });
    await prisma.outreachRecipient.create({ data: { pipeline: "dataleadsell", email: "refused@a.test", state: "refused" } });
    await prisma.outreachRecipient.create({
      data: { pipeline: "dataleadsell", email: "pitched@a.test", state: "sent", sentAt: new Date() },
    });
    for (const email of [
      "look@a.test",
      "thanks@a.test",
      "no@a.test",
      "gone@a.test",
      "refused@a.test",
      "pitched@a.test",
      "ok@a.test",
      "ok@a.test",
    ]) {
      await makeAgentLead({ email, status: "new" });
    }
    // Leads added after the replies carry no block yet, so the batch lists
    // them; the preview and the send both skip them for the reply.
    const preview = await previewBulkSend("dataleadsell");
    expect(preview.skipped).toEqual({
      neverPitch: 0,
      suppressed: 1,
      replyNeedsLook: 1,
      alreadyAnswered: 2,
      refusedEarlier: 1,
      alreadyPitched: 1,
      duplicateInBatch: 1,
    });
    expect(preview.willSend).toBe(1);

    const run = await sendBulkChunk("dataleadsell", preview.leadIds, { delayMs: 0, chunkSize: 50 });
    expect(run.sent).toBe(preview.willSend);
    // An address refused earlier is reported with the refusals; every other skip as a skip.
    expect(run.refused).toBe(preview.skipped.refusedEarlier);
    expect(run.skipped + run.refused).toBe(preview.leadIds.length - preview.willSend);
    expect(mail.to()).toEqual(["ok@a.test"]);
  });

  it("counts an answered address it can still see", async () => {
    await setAllowCrossPipelineRepeatsAction(true);
    // Created before the reply arrives, but its block was lifted by hand.
    const agent = await makeAgentLead({ email: "thanks@b.test", status: "new" });
    await inbound({ from: "thanks@b.test", text: "Got it" });
    await prisma.agentLead.update({ where: { id: agent.id }, data: { sendBlockedReason: null } });
    const preview = await previewBulkSend("dataleadsell");
    expect(preview.skipped.alreadyAnswered).toBe(1);
    expect(preview.willSend).toBe(0);
  });
});
