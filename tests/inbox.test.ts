// A pipeline's Inbox: sent, failed and replied, kept apart per pipeline.
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getPipelineInbox, gmailSearchUrl, parseInboxTab } from "@/lib/outreach/inbox";
import { makeAgentLead, makeColdLead } from "./helpers";

const at = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000);

describe("getPipelineInbox", () => {
  it("is empty on a fresh install", async () => {
    const inbox = await getPipelineInbox("cold-outreach");
    expect(inbox.counts).toEqual({ sent: 0, failed: 0, replied: 0 });
    expect(inbox.sent).toEqual([]);
  });

  it("lists sends newest first, leaving bounced ones and the other pipeline's out", async () => {
    const a = await makeColdLead({ name: "Acme Plumbing" });
    const b = await makeColdLead({ name: "Best Roofing" });
    await prisma.leadEmailSendLog.create({ data: { leadId: a.id, email: a.email!, subject: "Old", sentAt: at(3) } });
    await prisma.leadEmailSendLog.create({ data: { leadId: b.id, email: b.email!, subject: "New", sentAt: at(1) } });
    await prisma.leadEmailSendLog.create({ data: { leadId: b.id, email: b.email!, bounced: true, bouncedAt: at(0), sentAt: at(2) } });
    const agent = await makeAgentLead();
    await prisma.emailSendLog.create({ data: { leadId: agent.id, email: agent.email! } });

    const inbox = await getPipelineInbox("cold-outreach", "sent");
    expect(inbox.counts.sent).toBe(2);
    expect(inbox.sent.map((s) => [s.leadName, s.subject])).toEqual([
      ["Best Roofing", "New"],
      ["Acme Plumbing", "Old"],
    ]);
    expect((await getPipelineInbox("dataleadsell")).counts.sent).toBe(1);
  });

  it("lists bounces, refused and unconfirmed addresses and errored sends, one row per address", async () => {
    const bounced = await makeColdLead({ name: "Bounced Co" });
    await prisma.leadEmailSendLog.create({ data: { leadId: bounced.id, email: bounced.email!, bounced: true, bouncedAt: at(1) } });
    const refused = await makeColdLead({ name: "Refused Co", lastSendFailedAt: at(2), lastSendFailure: "550 user unknown" });
    await prisma.outreachRecipient.create({
      data: { pipeline: "cold-outreach", email: refused.email!, leadId: refused.id, state: "refused", lastError: "550 user unknown" },
    });
    const unknown = await makeColdLead({ name: "Dropped Co" });
    await prisma.outreachRecipient.create({
      data: { pipeline: "cold-outreach", email: unknown.email!, leadId: unknown.id, state: "unknown", claimedAt: at(4) },
    });
    await makeColdLead({ name: "Errored Co", lastSendFailedAt: at(3), lastSendFailure: "Connection timed out" });
    await prisma.outreachRecipient.create({ data: { pipeline: "dataleadsell", email: "x@y.test", state: "refused" } });

    const inbox = await getPipelineInbox("cold-outreach", "failed");
    expect(inbox.counts.failed).toBe(4);
    expect(inbox.failed.map((f) => [f.leadName, f.kind])).toEqual([
      ["Refused Co", "refused"],
      ["Bounced Co", "bounced"],
      ["Errored Co", "failed"],
      ["Dropped Co", "unknown"],
    ]);
  });

  it("lists replies recorded or attached to this pipeline's leads, and leads marked replied by hand", async () => {
    const lead = await makeAgentLead({ name: "Jane Agent", repliedAt: at(1) });
    const attached = await makeAgentLead({ name: "Assistant Match", repliedAt: at(2) });
    const byHand = await makeAgentLead({ name: "Phone Reply", repliedAt: at(3) });
    await prisma.inboundReply.create({
      data: {
        dedupeKey: "mid:1",
        fromEmail: lead.email!,
        subject: "Re: leads",
        text: "Yes, tell me more",
        optedOut: false,
        matched: [`dataleadsell:${lead.id}`],
        verdict: "positive",
        receivedAt: at(1),
      },
    });
    await prisma.inboundReply.create({
      data: {
        dedupeKey: "mid:2",
        fromEmail: "assistant@other.test",
        optedOut: false,
        matched: [],
        resolution: `attached:dataleadsell:${attached.id}`,
        verdict: "needs_look",
        receivedAt: at(2),
      },
    });
    // Automatic replies and the other pipeline's replies stay out.
    await prisma.inboundReply.create({
      data: { dedupeKey: "mid:3", fromEmail: lead.email!, optedOut: false, matched: [`dataleadsell:${lead.id}`], kind: "auto_reply" },
    });
    await prisma.inboundReply.create({
      data: { dedupeKey: "mid:4", fromEmail: "c@d.test", optedOut: false, matched: ["cold-outreach:abc"], verdict: "positive" },
    });

    const inbox = await getPipelineInbox("dataleadsell", "replied");
    expect(inbox.counts.replied).toBe(3);
    expect(inbox.replied.map((r) => [r.leadName, r.verdict])).toEqual([
      ["Jane Agent", "positive"],
      ["Assistant Match", "needs_look"],
      ["Phone Reply", "marked"],
    ]);
    expect(inbox.replied[0]!.text).toBe("Yes, tell me more");
    expect(inbox.replied[0]!.gmailUrl).toBe("https://mail.google.com/mail/u/0/#search/rfc822msgid%3A1");
    expect(inbox.replied[2]!.gmailUrl).toBe(`https://mail.google.com/mail/u/0/#search/from%3A${encodeURIComponent(byHand.email!)}`);
    expect(byHand.id).toBe(inbox.replied[2]!.leadId);
  });

  it("links a reply to Gmail by its Message-ID, or by sender without one", () => {
    expect(gmailSearchUrl("mid:<CAB1@mail.gmail.com>", "a@b.test")).toBe(
      "https://mail.google.com/mail/u/0/#search/rfc822msgid%3ACAB1%40mail.gmail.com",
    );
    expect(gmailSearchUrl("hash:abc", "a@b.test")).toBe("https://mail.google.com/mail/u/0/#search/from%3Aa%40b.test");
  });

  it("falls back to the Sent tab for an unknown tab", () => {
    expect(parseInboxTab("replied")).toBe("replied");
    expect(parseInboxTab("nope")).toBe("sent");
    expect(parseInboxTab(undefined)).toBe("sent");
  });
});
