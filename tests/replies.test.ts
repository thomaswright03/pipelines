// Reply tracking after a lead has left "Contacted", re-delivered replies,
// and a reply that arrives while the database is unreachable.
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { POST } from "@/app/api/email-inbound/route";
import { dismissReplyReviewAction, markBouncedAction, markRepliedAction, updateLeadStatusAction } from "@/lib/actions/outreach";
import { sendFirstTouch } from "@/lib/outreach/send";
import { routeStaleContacts } from "@/lib/outreach/stale-contacts";
import { getPipeline } from "@/lib/outreach/pipelines";
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

const EIGHT_DAYS_MS = 8 * 86_400_000;

let mail: ReturnType<typeof captureMail> | undefined;
afterEach(() => {
  mail?.restore();
  vi.restoreAllMocks();
});

/** Emails a lead for real (captured), then lets the stale-contacts job move it after a silent week. */
async function pitchAndGoStale(pipeline: "cold-outreach" | "dataleadsell", leadId: string) {
  mail ??= captureMail();
  expect(await sendFirstTouch(pipeline, leadId)).toMatchObject({ ok: true });
  const weekAgo = new Date(Date.now() - EIGHT_DAYS_MS);
  if (pipeline === "cold-outreach") await prisma.lead.update({ where: { id: leadId }, data: { lastEmailedAt: weekAgo } });
  else await prisma.agentLead.update({ where: { id: leadId }, data: { lastEmailedAt: weekAgo } });
  await routeStaleContacts();
}

describe("a reply after the lead left Contacted", () => {
  it("moves a Cold Outreach lead off the call deck to Responded and counts it in the reply rate", async () => {
    const lead = await makeColdLead({ email: "late@replier.test", phone: "(480) 555-0199" });
    await pitchAndGoStale("cold-outreach", lead.id);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("cold_call_list");
    const before = await getVaultStats();
    expect(before.replied).toBe(0);

    const res = await inbound({ from: "late@replier.test", subject: "Re: hello", text: "Yes I am interested, sorry for the slow reply" });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ matched: [`cold-outreach:${lead.id}`], optedOut: false, duplicate: false });
    const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after.status).toBe("responded");
    expect(after.repliedAt).not.toBeNull();
    expect(await prisma.lead.count({ where: { status: "cold_call_list" } })).toBe(0); // the call deck's query
    const stats = await getVaultStats();
    expect(stats.replied).toBe(1);
    expect(stats.replyRate).toBe(1);
  });

  it("does the same in dataleadsell, from the contactless list", async () => {
    const agent = await makeAgentLead({ email: "agent@late.test", phone: null });
    await pitchAndGoStale("dataleadsell", agent.id);
    expect((await prisma.agentLead.findUniqueOrThrow({ where: { id: agent.id } })).status).toBe("contactless_list");

    await inbound({ from: "Agent <agent@late.test>", text: "Tell me more about the probate leads." });

    const after = await prisma.agentLead.findUniqueOrThrow({ where: { id: agent.id } });
    expect(after).toMatchObject({ status: "responded", replyNeedsReview: false });
    expect(after.repliedAt).not.toBeNull();
    expect(after.notes).toBeNull();
    expect((await prisma.agentLeadActivity.findFirstOrThrow({ where: { leadId: agent.id } })).notes).toContain(
      "Tell me more about the probate leads.",
    );
    expect((await getDataleadsellStats()).replied).toBe(1);
  });

  it("records a reply to a Lost lead and flags it for review instead of silently dropping it", async () => {
    mail = captureMail();
    const lead = await makeColdLead({ email: "bounced@maybe.test" });
    await sendFirstTouch("cold-outreach", lead.id);
    await markBouncedAction("cold-outreach", lead.id); // Lost without a human decision about the prospect

    const json = await (await inbound({ from: "bounced@maybe.test", text: "Got your note after all — call me." })).json();

    expect(json.needsReview).toEqual([`cold-outreach:${lead.id}`]);
    const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after).toMatchObject({ status: "lost", replyNeedsReview: true });
    expect(after.repliedAt).not.toBeNull();
    expect((await getVaultStats()).replied).toBe(1);

    // Moving the lead is the review; so is "Keep as Lost".
    expect(await updateLeadStatusAction("cold-outreach", lead.id, "responded")).toMatchObject({ ok: true });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).replyNeedsReview).toBe(false);
  });

  it("clears the review flag when the operator keeps the lead where it is", async () => {
    const lead = await makeAgentLead({ status: "not_interested", lastEmailedAt: new Date(), replyNeedsReview: true });
    expect(await dismissReplyReviewAction("dataleadsell", lead.id)).toEqual({
      ok: true,
      message: `Marked the reply from ${lead.name} as reviewed — they stay Not interested.`,
    });
    expect((await prisma.agentLead.findUniqueOrThrow({ where: { id: lead.id } })).replyNeedsReview).toBe(false);
  });

  it("still suppresses an opt-out from the call deck, and moves the lead to Lost", async () => {
    const lead = await makeColdLead({ email: "stop@later.test", phone: "(480) 555-0100" });
    await pitchAndGoStale("cold-outreach", lead.id);

    const json = await (await inbound({ from: "stop@later.test", text: "Please remove me from your list" })).json();

    expect(json.optedOut).toBe(true);
    expect(await prisma.suppressedEmail.findUnique({ where: { email: "stop@later.test" } })).not.toBeNull();
    const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after.status).toBe("lost");
    expect(after.sendBlockedReason).toMatch(/^Opted out/);
    expect(after.replyNeedsReview).toBe(false);
  });

  it("doesn't count a reply from an address that was never emailed", async () => {
    const lead = await makeColdLead({ email: "never@pitched.test", status: "cold_call_list" });
    await inbound({ from: "never@pitched.test", text: "Who is this?" });
    const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after).toMatchObject({ status: "cold_call_list", repliedAt: null });
    expect(await prisma.leadActivity.count({ where: { leadId: lead.id } })).toBe(1);
  });
});

describe("Mark replied from the lead page", () => {
  it("works from the cold-call list for a lead that was emailed", async () => {
    const lead = await makeColdLead({ name: "Deck Lead", email: "deck@lead.test", phone: "(480) 555-0111" });
    await pitchAndGoStale("cold-outreach", lead.id);

    expect(await markRepliedAction("cold-outreach", lead.id)).toEqual({
      ok: true,
      message: "Marked Deck Lead as replied — moved from Cold call list to Responded.",
    });
    const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after.status).toBe("responded");
    expect((await getVaultStats()).replied).toBe(1);
  });

  it("works in dataleadsell too, and refuses a lead that was never emailed", async () => {
    const emailed = await makeAgentLead({ name: "Emailed Agent", email: "e@agent.test", phone: "(480) 555-0112" });
    await pitchAndGoStale("dataleadsell", emailed.id);
    expect(await markRepliedAction("dataleadsell", emailed.id)).toMatchObject({ ok: true });

    const never = await makeAgentLead({ name: "Phone Only", status: "cold_call_list" });
    expect(await markRepliedAction("dataleadsell", never.id)).toEqual({
      ok: false,
      error: "Phone Only was never emailed, so there's no email reply to record.",
    });
  });
});

describe("re-delivered replies", () => {
  it("records a reply once when the Worker sends it twice with the same Message-ID", async () => {
    const lead = await makeColdLead({ email: "twice@reply.test", status: "contacted", lastEmailedAt: new Date() });
    const payload = { from: "twice@reply.test", subject: "Re: hi", text: "Interested!", messageId: "<abc123@mail.test>" };

    const first = await (await inbound(payload)).json();
    const second = await (await inbound(payload)).json();

    expect(first.duplicate).toBe(false);
    expect(second).toMatchObject({ duplicate: true, matched: [`cold-outreach:${lead.id}`] });
    expect(await prisma.leadActivity.count({ where: { leadId: lead.id } })).toBe(1);
    expect(await prisma.inboundReply.count()).toBe(1);
  });

  it("falls back to sender + subject + body when there's no Message-ID", async () => {
    const agent = await makeAgentLead({ email: "nomid@reply.test", status: "contacted", lastEmailedAt: new Date() });
    const payload = { from: "nomid@reply.test", subject: "Re: leads", text: "Sounds good" };

    await inbound(payload);
    const second = await (await inbound({ ...payload, text: "  Sounds   good " })).json();

    expect(second.duplicate).toBe(true);
    expect(await prisma.agentLeadActivity.count({ where: { leadId: agent.id } })).toBe(1);

    // A different message from the same person is a new reply.
    expect((await (await inbound({ ...payload, text: "One more question" })).json()).duplicate).toBe(false);
  });
});

describe("a reply that arrives while the database is down", () => {
  it("answers 503 with retry: true, and a resend after recovery records it exactly once", async () => {
    const lead = await makeColdLead({ email: "outage@reply.test", status: "contacted", lastEmailedAt: new Date() });
    const payload = { from: "outage@reply.test", text: "Yes please", messageId: "<outage-1@mail.test>" };
    // The connection drops part-way through recording (after the dedupe check).
    const outage = vi
      .spyOn(getPipeline("dataleadsell"), "findLeadsByEmail")
      .mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:5432"));
    const failed = await inbound(payload);
    outage.mockRestore(); // the database is back
    expect(failed.status).toBe(503);
    const body = await failed.json();
    expect(body).toMatchObject({ retry: true, code: "db_unavailable" });
    expect(body).not.toHaveProperty("cause"); // internal details stay in the server log
    expect(JSON.stringify(body)).not.toContain("5432");
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("contacted");
    expect(await prisma.inboundReply.count()).toBe(0); // nothing half-recorded

    const retried = await inbound(payload);
    const again = await inbound(payload);
    expect(retried.status).toBe(200);
    expect(await again.json()).toMatchObject({ duplicate: true, retry: false });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("responded");
    expect(await prisma.leadActivity.count({ where: { leadId: lead.id } })).toBe(1);
  });

  it("tells the Worker not to retry a bad request", async () => {
    const res = await inbound({ subject: "no sender" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ retry: false });
  });
});

describe("stale-contacts routing", () => {
  it("moves only leads still Contacted: one that replied first is left alone", async () => {
    const old = new Date(Date.now() - EIGHT_DAYS_MS);
    const replied = await makeColdLead({ status: "responded", repliedAt: new Date(), lastEmailedAt: old, phone: "(480) 555-0120" });
    const withPhone = await makeColdLead({ status: "contacted", lastEmailedAt: old, phone: "(480) 555-0121" });
    const blankPhone = await makeColdLead({ status: "contacted", lastEmailedAt: old, phone: "" });
    const recent = await makeColdLead({ status: "contacted", lastEmailedAt: new Date() });

    const result = await routeStaleContacts();

    expect(result["cold-outreach"]).toEqual({ coldCall: 1, contactless: 1 });
    const status = async (id: string) => (await prisma.lead.findUniqueOrThrow({ where: { id } })).status;
    expect(await status(replied.id)).toBe("responded");
    expect(await status(withPhone.id)).toBe("cold_call_list");
    expect(await status(blankPhone.id)).toBe("contactless_list");
    expect(await status(recent.id)).toBe("contacted");
  });

  it("clears a backlog of 10,000 due leads in a few seconds", async () => {
    const old = new Date(Date.now() - EIGHT_DAYS_MS);
    await prisma.lead.createMany({
      data: Array.from({ length: 10_000 }, (_, i) => ({
        name: `Backlog ${i}`,
        status: "contacted",
        lastEmailedAt: old,
        phone: i % 2 ? "(480) 555-0100" : null,
      })),
    });
    const started = Date.now();
    const result = await routeStaleContacts();
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(result["cold-outreach"]).toEqual({ coldCall: 5_000, contactless: 5_000 });
    expect(await prisma.lead.count({ where: { status: "contacted" } })).toBe(0);
  });
});
