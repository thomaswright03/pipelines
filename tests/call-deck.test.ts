// What each call-deck card tells the caller, and a card order that a saved
// call doesn't reshuffle (so the deck's position survives a refresh).
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { loadCallDeck } from "@/lib/call-deck";
import { confirmColdCallAction } from "@/lib/actions/outreach";
import { makeAgentLead, makeColdLead } from "./helpers";

describe("call deck cards", () => {
  it("show the company, place, when the pitch went out and the latest history entry", async () => {
    const lead = await makeColdLead({
      name: "Pat Owner",
      company: "Bob's Bakery",
      city: "Mesa",
      state: "AZ",
      phone: "(480) 555-0101",
      status: "cold_call_list",
      lastEmailedAt: new Date("2026-09-10T18:00:00Z"),
    });
    await prisma.leadActivity.create({
      data: { leadId: lead.id, type: "note", notes: "Older note", date: new Date("2026-09-11T18:00:00Z") },
    });
    await prisma.leadActivity.create({
      data: { leadId: lead.id, type: "note", notes: "Asked to call after 3pm", date: new Date("2026-09-12T18:00:00Z") },
    });
    await makeColdLead({ name: "Never Mailed", status: "cold_call_list", email: null });

    const deck = (await loadCallDeck("cold-outreach")).cards;

    expect(deck[0]).toMatchObject({
      name: "Pat Owner",
      subtitle: "Bob's Bakery",
      city: "Mesa",
      state: "AZ",
      emailed: "Emailed Sep 10, 2026",
      lastNote: { date: "Sep 12, 2026", text: "Asked to call after 3pm" },
    });
    expect(deck[1]).toMatchObject({ name: "Never Mailed", emailed: "Never emailed", lastNote: null });
  });

  it("keep their order after a call is saved, and show a brokerage for agents", async () => {
    const first = await makeAgentLead({ name: "First Agent", brokerage: "HomeSmart", status: "cold_call_list" });
    await makeAgentLead({ name: "Second Agent", status: "cold_call_list" });
    await makeAgentLead({ name: "Starred Agent", status: "cold_call_list", starred: true });

    const before = (await loadCallDeck("dataleadsell")).cards.map((c) => c.name);
    expect(before).toEqual(["Starred Agent", "First Agent", "Second Agent"]);

    expect(await confirmColdCallAction("dataleadsell", first.id, "no_answer", "")).toMatchObject({ ok: true });
    const after = (await loadCallDeck("dataleadsell")).cards;
    expect(after.map((c) => c.name)).toEqual(before);
    expect(after[1]).toMatchObject({ subtitle: "HomeSmart", lastNote: { text: expect.stringMatching(/^Cold call — Didn't answer/) } });
  });
});

describe("a call list longer than one deck", () => {
  it("reports the true total and reaches every lead in batches", async () => {
    const created = Date.now() - 1_000_000;
    await prisma.lead.createMany({
      data: Array.from({ length: 250 }, (_, i) => ({
        name: `Caller ${String(i).padStart(3, "0")}`,
        status: "cold_call_list",
        phone: "(480) 555-0100",
        createdAt: new Date(created + i * 1000),
      })),
    });

    const first = await loadCallDeck("cold-outreach");
    expect(first).toMatchObject({ total: 250, offset: 0 });
    expect(first.cards).toHaveLength(200);
    expect(first.nextAfter).toBe(first.cards[199]!.id);

    // Working a card off the list meanwhile doesn't make the next batch skip anyone.
    await prisma.lead.update({ where: { id: first.cards[0]!.id }, data: { status: "lost" } });
    const second = await loadCallDeck("cold-outreach", { afterId: first.nextAfter! });
    expect(second).toMatchObject({ total: 249, offset: 199, nextAfter: null });
    expect(second.cards.map((c) => c.name)).toEqual(Array.from({ length: 50 }, (_, i) => `Caller ${200 + i}`));
  });

  it("keeps starred leads first across batches", async () => {
    const a = await makeColdLead({ name: "Plain A", status: "cold_call_list" });
    await makeColdLead({ name: "Starred", status: "cold_call_list", starred: true });
    await makeColdLead({ name: "Plain B", status: "cold_call_list" });

    const first = await loadCallDeck("cold-outreach", { limit: 2 });
    expect(first.cards.map((c) => c.name)).toEqual(["Starred", "Plain A"]);
    expect(first.nextAfter).toBe(a.id);
    const rest = await loadCallDeck("cold-outreach", { afterId: first.nextAfter!, limit: 2 });
    expect(rest).toMatchObject({ offset: 2, total: 3, nextAfter: null });
    expect(rest.cards.map((c) => c.name)).toEqual(["Plain B"]);
  });

  it("starts from the top when the cursor lead is gone", async () => {
    await makeColdLead({ name: "Only", status: "cold_call_list" });
    const deck = await loadCallDeck("cold-outreach", { afterId: "no-such-lead" });
    expect(deck).toMatchObject({ total: 1, offset: 0, nextAfter: null });
    expect(deck.cards.map((c) => c.name)).toEqual(["Only"]);
  });
});

describe("a card for a lead whose reply needs a look", () => {
  it("carries the review reason", async () => {
    await makeAgentLead({
      name: "Flagged Agent",
      status: "cold_call_list",
      replyNeedsReview: true,
      replyReviewReason: "The reply sounds like a complaint. It may be asking not to be emailed.",
    });
    await makeAgentLead({ name: "Clear Agent", status: "cold_call_list" });
    const { cards } = await loadCallDeck("dataleadsell");
    expect(cards.find((c) => c.name === "Flagged Agent")?.review).toMatch(/sounds like a complaint/);
    expect(cards.find((c) => c.name === "Clear Agent")?.review).toBeNull();
  });
});
