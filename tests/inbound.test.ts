import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { POST } from "@/app/api/email-inbound/route";
import { removeSuppressionAction } from "@/lib/actions/outreach";
import { sendFirstTouch } from "@/lib/outreach/send";
import { captureMail, makeAgentLead, makeColdLead } from "./helpers";

function inbound(body: unknown, auth = "Bearer test-inbound-secret") {
  return POST(
    new NextRequest("http://localhost/api/email-inbound", {
      method: "POST",
      headers: { authorization: auth, "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

let mail: ReturnType<typeof captureMail> | undefined;
afterEach(() => mail?.restore());

describe("/api/email-inbound", () => {
  it("rejects a missing or wrong bearer token", async () => {
    expect((await inbound({ from: "x@example.test" }, "Bearer wrong")).status).toBe(401);
    expect((await inbound({ from: "x@example.test" }, "")).status).toBe(401);
  });

  it("rejects a malformed body with 400, not a crash", async () => {
    expect((await inbound("not json")).status).toBe(400);
    expect((await inbound({ subject: "no from" })).status).toBe(400);
  });

  it("records an interested reply as a reply — even with the quoted 'Reply STOP' footer", async () => {
    const cold = await makeColdLead({ email: "x@example.test", status: "contacted" });
    const agent = await makeAgentLead({ email: "x@example.test", status: "contacted" });

    const res = await inbound({
      from: "Pat Prospect <X@Example.test>",
      subject: "Re: I probably shouldn't have sent this",
      text: "Yes, interested!\n\nOn Thu … wrote:\n> Reply STOP and we won't email you again.",
    });
    const json = await res.json();

    expect(json.optedOut).toBe(false);
    expect(json.matched.sort()).toEqual([`cold-outreach:${cold.id}`, `dataleadsell:${agent.id}`].sort());
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: cold.id } })).status).toBe("responded");
    expect((await prisma.agentLead.findUniqueOrThrow({ where: { id: agent.id } })).status).toBe("responded");
    expect(await prisma.suppressedEmail.count()).toBe(0);
    const activity = await prisma.leadActivity.findFirstOrThrow({ where: { leadId: cold.id } });
    expect(activity.notes).toContain("Yes, interested!");
    expect(activity.notes).not.toContain("Reply STOP");
  });

  it("treats 'I don't want these emails' as an opt-out, not a positive reply", async () => {
    const cold = await makeColdLead({ email: "joe@joesplumbing.test", status: "contacted" });
    const agent = await makeAgentLead({ email: "joe@joesplumbing.test", status: "contacted" });

    const json = await (await inbound({ from: "joe@joesplumbing.test", text: "I don't want these emails" })).json();

    expect(json).toMatchObject({ optedOut: true, review: null });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: cold.id } })).status).toBe("lost");
    expect((await prisma.agentLead.findUniqueOrThrow({ where: { id: agent.id } })).status).toBe("not_interested");
    expect(await prisma.suppressedEmail.findUnique({ where: { email: "joe@joesplumbing.test" } })).not.toBeNull();
  });

  it.each(["Knock it off.", "Enough with the emails.", "Lose my email.", "Honestly I do not want any of these emails"])(
    "treats the curt opt-out %j as an opt-out",
    async (text) => {
      const cold = await makeColdLead({ email: "curt@shop.test", status: "contacted" });
      const json = await (await inbound({ from: "curt@shop.test", text })).json();
      expect(json).toMatchObject({ optedOut: true });
      expect((await prisma.lead.findUniqueOrThrow({ where: { id: cold.id } })).status).toBe("lost");
      expect(await prisma.suppressedEmail.findUnique({ where: { email: "curt@shop.test" } })).not.toBeNull();
    },
  );

  it.each(["No, thank you.", "Not for us, thanks", "We're good, no need.", "We don't need a website.", "Who is this?"])(
    "flags the brush-off %j for a look and keeps the lead out of Responded",
    async (text) => {
      const cold = await makeColdLead({ email: "meh@shop.test", status: "contacted", lastEmailedAt: new Date() });
      const json = await (await inbound({ from: "meh@shop.test", text })).json();
      expect(json.optedOut).toBe(false);
      expect(json.review).toEqual(expect.any(String));
      const after = await prisma.lead.findUniqueOrThrow({ where: { id: cold.id } });
      expect(after).toMatchObject({ status: "contacted", replyNeedsReview: true, repliedAt: null });
      expect(await prisma.suppressedEmail.count()).toBe(0);
    },
  );

  // Round 9: replies that match no listed phrase used to count as positive.
  it.each([
    ["I'd rather not receive these", "opt-out"],
    ["I would rather not receive these.", "opt-out"],
    ["Lose my number", "look"],
    ["F off", "opt-out"],
    ["Bitte keine E-Mails mehr", "opt-out"],
    ["Pass.", "look"],
    ["We are not the right business for this", "look"],
  ] as const)("never counts %j as a positive reply (%s)", async (text, outcome) => {
    const cold = await makeColdLead({ email: "decline@shop.test", status: "contacted", lastEmailedAt: new Date() });
    const json = await (await inbound({ from: "decline@shop.test", messageId: `<${text}@test>`, text })).json();
    const after = await prisma.lead.findUniqueOrThrow({ where: { id: cold.id } });
    const suppressed = await prisma.suppressedEmail.findUnique({ where: { email: "decline@shop.test" } });
    expect(after.status).not.toBe("responded");
    // An opt-out keeps its reply time (the Stats reply rate leaves opted-out
    // addresses out); a reply flagged for a look gets none until the operator decides.
    if (outcome === "opt-out") {
      expect(json.optedOut).toBe(true);
      expect(after.status).toBe("lost");
      expect(suppressed).not.toBeNull();
    } else {
      expect(json.optedOut).toBe(false);
      expect(after).toMatchObject({ status: "contacted", replyNeedsReview: true, repliedAt: null });
      expect(suppressed).toBeNull();
    }
  });

  it("still moves an interested reply to Responded", async () => {
    const cold = await makeColdLead({ email: "keen@shop.test", status: "contacted", lastEmailedAt: new Date() });
    await inbound({ from: "keen@shop.test", messageId: "<keen@test>", text: "Yes, interested — what does it cost?" });
    const after = await prisma.lead.findUniqueOrThrow({ where: { id: cold.id } });
    expect(after).toMatchObject({ status: "responded", replyNeedsReview: false });
    expect(after.repliedAt).not.toBeNull();
  });

  it("flags an interested reply that asks to stop phone calls, without suppressing it", async () => {
    const cold = await makeColdLead({ email: "cell@shop.test", status: "contacted", lastEmailedAt: new Date() });
    const json = await (
      await inbound({ from: "cell@shop.test", text: "How much for a website? Also please stop calling my cell, email only." })
    ).json();
    expect(json.optedOut).toBe(false);
    const after = await prisma.lead.findUniqueOrThrow({ where: { id: cold.id } });
    expect(after).toMatchObject({ status: "contacted", replyNeedsReview: true, repliedAt: null });
    expect(await prisma.suppressedEmail.count()).toBe(0);
  });

  it("flags an unclear reply from a customer for a look, keeping the customer's status", async () => {
    const lead = await makeColdLead({ email: "client@shop.test", status: "paying_client", lastEmailedAt: new Date() });
    await inbound({ from: "client@shop.test", text: "Thanks for the invoice." });
    const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after).toMatchObject({ status: "paying_client", replyNeedsReview: true });
    const activity = await prisma.leadActivity.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(activity.notes).toContain("Needs a look");
  });

  it("flags a Spanish reply it doesn't understand for a look instead of moving the lead to Responded", async () => {
    const cold = await makeColdLead({ email: "ana@panaderia.test", status: "contacted" });
    const json = await (await inbound({ from: "ana@panaderia.test", text: "Hola, ¿de dónde sacó mi correo? Gracias." })).json();
    expect(json.optedOut).toBe(false);
    expect(json.review).toMatch(/another language/);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: cold.id } })).status).not.toBe("responded");
  });

  it("suppresses a genuine STOP, keeps the evidence, and blocks future sends", async () => {
    mail = captureMail();
    const lead = await makeColdLead({ email: "stop@example.test", status: "contacted" });
    const other = await makeAgentLead({ email: "stop@example.test" });

    const json = await (await inbound({ from: "stop@example.test", subject: "Re: hi", text: "STOP" })).json();

    expect(json).toMatchObject({ optedOut: true, trigger: "STOP" });
    expect(await prisma.suppressedEmail.findUniqueOrThrow({ where: { email: "stop@example.test" } })).toMatchObject({
      source: "inbound_reply",
      evidence: "STOP",
    });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("lost");
    expect(await sendFirstTouch("dataleadsell", other.id)).toMatchObject({ ok: false, reason: "blocked" });
    expect(mail.messages).toHaveLength(0);
  });

  it("lets the operator reverse a wrong opt-out from the lead", async () => {
    const lead = await makeColdLead({ email: "oops@example.test", status: "contacted" });
    await inbound({ from: "oops@example.test", text: "Please remove me" });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("lost");

    const result = await removeSuppressionAction("cold-outreach", lead.id);

    expect(result).toEqual({
      ok: true,
      message: `Removed oops@example.test from the do-not-email list — ${lead.name} is back to Responded.`,
    });
    const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after).toMatchObject({ status: "responded", sendBlockedReason: null });
    expect(await prisma.suppressedEmail.count()).toBe(0);
  });
});
