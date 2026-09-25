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

    const deck = await loadCallDeck("cold-outreach");

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

    const before = (await loadCallDeck("dataleadsell")).map((c) => c.name);
    expect(before).toEqual(["Starred Agent", "First Agent", "Second Agent"]);

    expect(await confirmColdCallAction("dataleadsell", first.id, "no_answer", "")).toMatchObject({ ok: true });
    const after = await loadCallDeck("dataleadsell");
    expect(after.map((c) => c.name)).toEqual(before);
    expect(after[1]).toMatchObject({ subtitle: "HomeSmart", lastNote: { text: expect.stringMatching(/^Cold call — Didn't answer/) } });
  });
});
