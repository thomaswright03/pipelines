// Opt-out phrasing end to end, replies that need a look, reply/call history
// kept out of the notes limit, lookups against unreachable sites, "Find
// email" guards, bouncing after the stale-contacts move, and the
// correction counts that measure the heuristics in production.
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { POST } from "@/app/api/email-inbound/route";
import {
  confirmColdCallAction,
  findLeadEmailAction,
  markBouncedAction,
  markOptedOutAction,
  removeSuppressionAction,
} from "@/lib/actions/outreach";
import { updateAgentAction } from "@/lib/actions/dataleadsell";
import { updateLeadAction } from "@/lib/actions/vault-pipeline";
import { removeSuppressionByEmailAction } from "@/lib/actions/settings";
import { findEmailForLead, findEmailsChunk, LOOKUP_RETRY_AFTER_MS } from "@/lib/outreach/discovery";
import { getPipeline } from "@/lib/outreach/pipelines";
import { sendFirstTouch } from "@/lib/outreach/send";
import { routeStaleContacts } from "@/lib/outreach/stale-contacts";
import { getQualitySignals } from "@/lib/outreach/corrections";
import { getDataleadsellStats, getVaultStats } from "@/lib/pipeline-stats";
import { captureMail, makeAgentLead, makeColdLead, page, stubFetch } from "./helpers";

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
  mail = undefined;
});

const AGENT_FORM = { name: "", brokerage: "", email: "", phone: "", city: "", county: "Maricopa", website: "", notes: "" };

describe("plain opt-out replies (finding 2)", () => {
  it("'Don't email me.' suppresses the address and closes the lead in both pipelines", async () => {
    const agent = await makeAgentLead({ email: "dont@reply.test", status: "contacted", lastEmailedAt: new Date() });
    const cold = await makeColdLead({ email: "dont@reply.test", status: "contacted", lastEmailedAt: new Date() });

    const json = await (await inbound({ from: "x <dont@reply.test>", text: "Don't email me." })).json();

    expect(json).toMatchObject({ optedOut: true, trigger: "Don't email me." });
    expect(await prisma.suppressedEmail.findUnique({ where: { email: "dont@reply.test" } })).toMatchObject({
      source: "inbound_reply",
      evidence: "Don't email me.",
    });
    expect((await prisma.agentLead.findUniqueOrThrow({ where: { id: agent.id } })).status).toBe("not_interested");
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: cold.id } })).status).toBe("lost");
  });

  it("an ambiguous 'not interested' flags the lead for a look instead of moving it to Responded", async () => {
    const agent = await makeAgentLead({ email: "meh@reply.test", status: "contacted", lastEmailedAt: new Date() });

    const json = await (await inbound({ from: "meh@reply.test", text: "Not interested at this time." })).json();

    expect(json).toMatchObject({ optedOut: false, needsReview: [`dataleadsell:${agent.id}`] });
    expect(json.review).toMatch(/not interested/);
    const after = await prisma.agentLead.findUniqueOrThrow({ where: { id: agent.id } });
    expect(after).toMatchObject({ status: "contacted", replyNeedsReview: true });
    expect(after.replyReviewReason).toMatch(/not interested.*may be asking not to be emailed/);
    expect(after.repliedAt).not.toBeNull();
    expect(await prisma.suppressedEmail.count()).toBe(0);
    expect((await prisma.inboundReply.findFirstOrThrow()).reviewReason).toMatch(/not interested/);

    // The operator decides it was an opt-out: the flag clears and the miss is counted.
    expect(await markOptedOutAction("dataleadsell", agent.id)).toMatchObject({ ok: true });
    const decided = await prisma.agentLead.findUniqueOrThrow({ where: { id: agent.id } });
    expect(decided).toMatchObject({ status: "not_interested", replyNeedsReview: false, replyReviewReason: null });
    expect(await getQualitySignals()).toMatchObject({ flaggedForReview: 1, optOutsMissed: 1 });
  });
});

describe("reply and call history stay out of the notes limit (finding 3)", () => {
  it("three 2,000-character replies, then editing only the phone number, succeeds", async () => {
    const agent = await makeAgentLead({
      name: "Long Replier",
      email: "long@reply.test",
      status: "contacted",
      lastEmailedAt: new Date(),
      notes: "Met at the open house.",
    });
    for (let i = 0; i < 3; i++) {
      await inbound({ from: "long@reply.test", subject: `Re: ${i}`, text: `Reply ${i}: ${"interested ".repeat(180)}` });
    }

    const result = await updateAgentAction(agent.id, {
      ...AGENT_FORM,
      name: "Long Replier",
      email: "long@reply.test",
      phone: "(480) 555-0199",
      notes: "Met at the open house.",
    });

    expect(result).toEqual({ ok: true, leadId: agent.id });
    const after = await prisma.agentLead.findUniqueOrThrow({ where: { id: agent.id } });
    expect(after).toMatchObject({ phone: "(480) 555-0199", notes: "Met at the open house." });
    const history = await prisma.agentLeadActivity.findMany({ where: { leadId: agent.id }, orderBy: { date: "asc" } });
    expect(history).toHaveLength(3);
    expect(history.map((h) => h.notes.slice(0, 80))).toEqual([
      expect.stringContaining("Re: 0"),
      expect.stringContaining("Re: 1"),
      expect.stringContaining("Re: 2"),
    ]);
  });

  it("a lead whose notes already exceed the limit stays editable, but its notes can't grow", async () => {
    const longNotes = "Old reply history. ".repeat(400).trim(); // ~7,600 characters
    const lead = await makeColdLead({ name: "Legacy Notes", email: null, notes: longNotes });
    const form = {
      name: "Legacy Notes",
      company: "",
      email: "",
      phone: "(480) 555-0123",
      address: "",
      city: "",
      state: "",
      website: "",
      source: "",
      estimatedValue: "2500.10",
      notes: longNotes,
    };

    expect(await updateLeadAction(lead.id, form)).toEqual({ ok: true, leadId: lead.id });
    const saved = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(saved).toMatchObject({ phone: "(480) 555-0123", estimatedValueCents: 250010 });

    const grown = await updateLeadAction(lead.id, { ...form, notes: `${longNotes} more` });
    expect(grown.fieldErrors?.notes).toMatch(/can't grow past/);
  });

  it("cold-call notes go to the history in both pipelines", async () => {
    const cold = await makeColdLead({ status: "cold_call_list", phone: "(480) 555-0100" });
    expect(await confirmColdCallAction("cold-outreach", cold.id, "no_answer", "Voicemail full")).toMatchObject({ ok: true });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: cold.id } })).notes).toBeNull();
    expect((await prisma.leadActivity.findFirstOrThrow({ where: { leadId: cold.id } })).notes).toBe(
      "Cold call — Didn't answer: Voicemail full",
    );
  });
});

describe("lookups against a site that can't be reached (finding 4)", () => {
  const timeout = () => Promise.reject(new DOMException("The operation was aborted.", "TimeoutError"));

  it("leaves a New lead New and unchecked, and says the site couldn't be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(timeout));
    const lead = await makeColdLead({ email: null, website: "https://www.slowplumbing.test", phone: "(480) 555-0101" });

    const outcome = await findEmailForLead("cold-outreach", (await getPipeline("cold-outreach").findLead(prisma, lead.id))!);

    expect(outcome).toEqual({ kind: "unreachable", website: "https://www.slowplumbing.test" });
    const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after).toMatchObject({ status: "new", emailCheckedAt: null });
    expect(after.emailLookupFailedAt).not.toBeNull();

    const action = await findLeadEmailAction("cold-outreach", lead.id);
    expect(action).toMatchObject({ ok: false });
    expect(!action.ok && action.error).toMatch(/Couldn't reach www\.slowplumbing\.test just now.*stays New/);
  });

  it("a 5xx on every guessed domain is also not a verdict", async () => {
    stubFetch({ "https://www.": () => ({ status: 503, body: "down" }) });
    const agent = await makeAgentLead({ name: "Pat Busy", email: null, phone: "(480) 555-0102" });
    const outcome = await findEmailForLead("dataleadsell", (await getPipeline("dataleadsell").findLead(prisma, agent.id))!);
    expect(outcome.kind).toBe("unreachable");
    expect((await prisma.agentLead.findUniqueOrThrow({ where: { id: agent.id } })).status).toBe("new");
  });

  it("a completed scan with no address still routes the lead to phone outreach", async () => {
    stubFetch({ "https://www.quietplumbing.test": page("Call us, we don't do email.") });
    const lead = await makeColdLead({ email: null, website: "https://www.quietplumbing.test", phone: "(480) 555-0103" });
    const outcome = await findEmailForLead("cold-outreach", (await getPipeline("cold-outreach").findLead(prisma, lead.id))!);
    expect(outcome).toEqual({ kind: "none", routedTo: "cold_call_list", unverified: null });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).emailCheckedAt).not.toBeNull();
  });

  it("the bulk sweep skips an unreachable lead for an hour, then tries it again", async () => {
    vi.stubGlobal("fetch", vi.fn(timeout));
    await makeColdLead({ email: null, website: "https://www.slowplumbing.test" });

    expect(await findEmailsChunk("cold-outreach")).toEqual({ checked: 0, found: 0, unreachable: 1, remaining: 0 });
    // Straight away: nothing due, so a sweep ends instead of hammering the site.
    expect(await findEmailsChunk("cold-outreach")).toEqual({ checked: 0, found: 0, unreachable: 0, remaining: 0 });

    stubFetch({ "https://www.slowplumbing.test": page("Slow Plumbing — mail slow@slowplumbing.test") });
    const later = new Date(Date.now() + LOOKUP_RETRY_AFTER_MS + 1_000);
    expect(await findEmailsChunk("cold-outreach", later)).toEqual({ checked: 1, found: 1, unreachable: 0, remaining: 0 });
  });
});

describe("'Find email' never replaces an address (finding 11)", () => {
  it("refuses for a Contacted lead and leaves the stored address alone", async () => {
    const lead = await makeColdLead({ email: "kept@pitched.test", status: "contacted", lastEmailedAt: new Date() });
    const result = await findLeadEmailAction("cold-outreach", lead.id);
    expect(result).toEqual({ ok: false, error: `${lead.name} already has an address (kept@pitched.test).` });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).email).toBe("kept@pitched.test");
  });

  it("doesn't save a found address if the lead got one while the lookup ran", async () => {
    const lead = await makeColdLead({ email: null, website: "https://www.racey.test", city: "Mesa" });
    stubFetch({ "https://www.racey.test": page("Racey of Mesa: found@racey.test") });
    // The lookup started from this snapshot; an operator then typed an address in.
    const snapshot = (await getPipeline("cold-outreach").findLead(prisma, lead.id))!;
    await prisma.lead.update({ where: { id: lead.id }, data: { email: "typed@racey.test" } });

    const outcome = await findEmailForLead("cold-outreach", snapshot);

    expect(outcome.kind).toBe("refused");
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).email).toBe("typed@racey.test");
  });
});

describe("bounces after the lead moved to phone outreach (finding 10)", () => {
  it("can be marked, and count in Stats", async () => {
    mail = captureMail();
    const lead = await makeColdLead({ email: "gone@bounce.test", phone: "(480) 555-0104", emailEvidence: "Found on bounce.test." });
    expect(await sendFirstTouch("cold-outreach", lead.id)).toMatchObject({ ok: true });
    await prisma.lead.update({ where: { id: lead.id }, data: { lastEmailedAt: new Date(Date.now() - 8 * 86_400_000) } });
    await routeStaleContacts();
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("cold_call_list");

    expect(await markBouncedAction("cold-outreach", lead.id)).toEqual({
      ok: true,
      message: `Marked ${lead.name} as bounced — moved from Cold call list to Lost.`,
    });
    expect((await getVaultStats()).bounced).toBe(1);
    // A second press doesn't count it twice.
    expect(await markBouncedAction("cold-outreach", lead.id)).toMatchObject({ ok: false });
    // The address was found by the lookup, so it counts against the finder.
    expect((await getQualitySignals()).foundAddressesBounced).toBe(1);
  });

  it("keeps a customer's status", async () => {
    mail = captureMail();
    const agent = await makeAgentLead({ email: "client@bounce.test", emailEvidence: "Entered by hand on Sep 1, 2026." });
    expect(await sendFirstTouch("dataleadsell", agent.id)).toMatchObject({ ok: true });
    await prisma.agentLead.update({ where: { id: agent.id }, data: { status: "subscribed" } });
    expect(await markBouncedAction("dataleadsell", agent.id)).toMatchObject({ ok: true });
    expect((await prisma.agentLead.findUniqueOrThrow({ where: { id: agent.id } })).status).toBe("subscribed");
    expect((await getDataleadsellStats()).bounced).toBe(1);
    // Typed in by hand: not the finder's mistake.
    expect((await getQualitySignals()).foundAddressesBounced).toBe(0);
  });
});

describe("correction counts (finding 5)", () => {
  it("counts auto opt-outs the operator reversed, from the lead page or Settings", async () => {
    const a = await makeColdLead({ email: "oops@reply.test", status: "contacted", lastEmailedAt: new Date() });
    await makeAgentLead({ email: "oops2@reply.test", status: "contacted", lastEmailedAt: new Date() });
    await inbound({ from: "oops@reply.test", text: "Stop emailing me." });
    await inbound({ from: "oops2@reply.test", text: "Unsubscribe" });

    expect(await removeSuppressionAction("cold-outreach", a.id)).toMatchObject({ ok: true });
    expect(await removeSuppressionByEmailAction("oops2@reply.test")).toMatchObject({ ok: true });

    expect(await getQualitySignals()).toMatchObject({ autoOptOuts: 2, optOutsReversed: 2, optOutsMissed: 0 });
  });
});
