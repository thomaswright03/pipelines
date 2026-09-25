// Replies from an address no lead has are kept with their text, listed, and
// can be attached to the right lead (applying the normal reply rules) or
// dismissed. The pages also show whether replies are arriving at all.
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { POST } from "@/app/api/email-inbound/route";
import { attachReplyAction, dismissReplyAction, searchLeadsForReplyAction } from "@/lib/actions/replies";
import { countUnmatchedReplies, listUnmatchedReplies } from "@/lib/outreach/inbound";
import { getReplyHealth, shouldWarn } from "@/lib/outreach/reply-health";
import { getSuppression } from "@/lib/email-suppression";
import { makeAgentLead, makeColdLead } from "./helpers";

function inbound(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/email-inbound", {
      method: "POST",
      headers: { authorization: "Bearer test-inbound-secret", "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("unmatched replies", () => {
  it("are listed with their text, and attaching one to a Contacted lead moves it to Responded", async () => {
    const lead = await makeColdLead({ name: "Boss Co", email: "boss@company.test", status: "contacted", lastEmailedAt: new Date() });

    const res = await inbound({
      from: "Assistant <assistant@otherdomain.test>",
      subject: "Re: I probably shouldn't have sent this",
      text: "Forwarding for my boss - interested!\n\nOn Thu … wrote:\n> Hey there",
      messageId: "<fwd-1@otherdomain.test>",
    });
    expect(await res.json()).toMatchObject({ matched: [] });

    const [reply] = await listUnmatchedReplies();
    expect(reply).toMatchObject({ fromEmail: "assistant@otherdomain.test", text: "Forwarding for my boss - interested!", optedOut: false });
    expect(await countUnmatchedReplies()).toBe(1);

    const search = await searchLeadsForReplyAction("boss");
    expect(search).toMatchObject({ ok: true, leads: [{ pipeline: "cold-outreach", id: lead.id, name: "Boss Co" }] });

    const attached = await attachReplyAction(reply!.id, "cold-outreach", lead.id);
    expect(attached).toEqual({ ok: true, message: "Added the reply from assistant@otherdomain.test to Boss Co — moved to Responded." });
    const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after.status).toBe("responded");
    expect(after.repliedAt).not.toBeNull();
    expect(await prisma.leadActivity.findFirst({ where: { leadId: lead.id } })).toMatchObject({
      notes: expect.stringContaining("from assistant@otherdomain.test"),
    });
    expect(await countUnmatchedReplies()).toBe(0);
    expect(await attachReplyAction(reply!.id, "cold-outreach", lead.id)).toMatchObject({ ok: false });
  });

  it("attaching an opt-out puts the lead's own address on the do-not-email list too", async () => {
    const agent = await makeAgentLead({ name: "Jane Doe", email: "jane@kw.test", status: "contacted", lastEmailedAt: new Date() });
    await inbound({ from: "jane.personal@gmail.test", subject: "Re: Probate leads", text: "Please stop emailing me." });
    const [reply] = await listUnmatchedReplies();
    expect(reply!.optedOut).toBe(true);

    await attachReplyAction(reply!.id, "dataleadsell", agent.id);

    expect(await getSuppression("jane@kw.test")).not.toBeNull();
    expect(await prisma.agentLead.findUniqueOrThrow({ where: { id: agent.id } })).toMatchObject({ status: "not_interested" });
  });

  it("can be dismissed without touching any lead", async () => {
    await inbound({ from: "someone@else.test", subject: "Hello", text: "Wrong person" });
    const [reply] = await listUnmatchedReplies();
    expect(await dismissReplyAction(reply!.id)).toEqual({ ok: true, message: "Dismissed the reply." });
    expect(await listUnmatchedReplies()).toEqual([]);
  });
});

describe("reply tracking health", () => {
  const day = 86_400_000;

  it("warns when emails went out more than 2 days ago — however long ago — and no reply has arrived in a week", async () => {
    const now = new Date();
    expect(shouldWarn(0, null, now)).toBe(false);
    expect(shouldWarn(3, null, now)).toBe(true);
    expect(shouldWarn(3, new Date(now.getTime() - 8 * day), now)).toBe(true);
    expect(shouldWarn(3, new Date(now.getTime() - 1 * day), now)).toBe(false);

    // Sends a month old with no reply since still warn.
    await prisma.outreachRecipient.create({
      data: { pipeline: "cold-outreach", email: "old@x.test", state: "sent", sentAt: new Date(Date.now() - 30 * day) },
    });
    expect(await getReplyHealth()).toMatchObject({ warning: true, sendsPastGrace: 1 });
    await prisma.outreachRecipient.deleteMany();

    await prisma.outreachRecipient.create({
      data: { pipeline: "cold-outreach", email: "a@x.test", state: "sent", sentAt: new Date(Date.now() - 3 * day) },
    });
    expect(await getReplyHealth()).toMatchObject({ warning: true, lastReplyAt: null, sendsPastGrace: 1 });

    await inbound({ from: "anyone@x.test", subject: "Re: hi", text: "Thanks" });
    const health = await getReplyHealth();
    expect(health.warning).toBe(false);
    expect(health.lastReplyAt).toBeInstanceOf(Date);
  });
});
