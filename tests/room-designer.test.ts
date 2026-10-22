// The Room Designer 3D pipeline: its pitch (Thomas's wording), who it never
// pitches, that its weekday run finds remodelers and emails nobody while
// sending is held, and that it sends once the hold is lifted.
import { afterEach, describe, expect, it, onTestFinished } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { buildRemodelerOutreachEmail, ROOM_DESIGNER_TEMPLATE_VERSION } from "@/lib/room-designer-email-template";
import { ROOM_DESIGNER_HOLD_MESSAGE, ROOM_DESIGNER_SENDING_HELD } from "@/lib/room-designer-config";
import { remodelerExclusion, remodelerPitchExclusion } from "@/lib/room-designer-targeting";
import { peekNextRemodelerCity } from "@/lib/room-designer-city-picker";
import { ROOM_DESIGNER_DAILY_SOURCE, runDailyRoomDesigner } from "@/lib/room-designer-daily-run";
import { createRemodelerAction, runRemodelerScrapeAction, searchRemodelersAction } from "@/lib/actions/room-designer";
import { updateRoomDesignerScheduleAction } from "@/lib/actions/pipeline-schedule";
import { GET as roomDesignerDailyGET } from "@/app/api/cron/room-designer-daily/route";
import { getPipelineSchedule, ROOM_DESIGNER_SCHEDULE_ID } from "@/lib/pipeline-schedule";
import { previewBulkSend, sendFirstTouch } from "@/lib/outreach/send";
import { getPipeline } from "@/lib/outreach/pipelines";
import { allowedTransitions, ROOM_DESIGNER_STATUSES, statusLabel } from "@/lib/lead-status";
import { captureMail, makeRemodelerLead, page, seedPlaces, stubFetch } from "./helpers";

/** Every city lists two sendable remodelers and one of each kind Room Designer 3D never pitches. */
async function stubRemodelerSearch() {
  const remodel = ["General Contractor", "Bathroom Contractor"];
  await seedPlaces(
    [
      { name: "Desert Bath Remodel", phone: "(480) 555-2001", categories: remodel },
      { name: "Saguaro Renovations", phone: "(480) 555-2002", categories: ["General Contractor"] },
      { name: "Bath Fitter", phone: "(480) 555-2003", categories: remodel },
      { name: "Eddy's Remodeling", phone: "(480) 555-2004", categories: remodel },
      { name: "Valley Plumbing", phone: "(480) 555-2005", categories: ["Plumber"] },
      { name: "Tile Supply Co", phone: "(480) 555-2006", categories: ["Construction Supplies Store", "General Contractor"] },
    ],
    { kind: "remodeler" },
  );
  // Other businesses in the same cities are never searched for remodelers.
  await seedPlaces([{ name: "Desert Bakery", website: "https://www.desertbakery.test" }], { kind: "business" });
  return stubFetch({
    "https://www.desertbathremodel.com": page("Desert Bath Remodel — 480-555-2001 — info@desertbathremodel.test"),
    "https://www.saguarorenovations.com": page("Saguaro Renovations, call 480-555-2002 or email office@saguarorenovations.test"),
  });
}

/** Lifts the code hold for one test (it ships held). */
function liftHold() {
  const adapter = getPipeline("room-designer") as { sendHold: string | null };
  const before = adapter.sendHold;
  adapter.sendHold = null;
  onTestFinished(() => {
    adapter.sendHold = before;
  });
}

let mail: ReturnType<typeof captureMail> | undefined;
afterEach(() => mail?.restore());

describe("the Room Designer 3D pitch", () => {
  it("is Thomas's wording, word for word", () => {
    const { subject, body } = buildRemodelerOutreachEmail({ name: "Desert Bath Remodel", company: "Desert Bath Remodel" });
    expect(subject).toBe("show your customers their new bathroom in 3D");
    expect(body).toBe(
      [
        "Hey there,",
        "",
        "I'm Thomas. I built Room Designer 3D for bathroom remodelers like Desert Bath Remodel.",
        "",
        "You sit down with a customer, enter the room's size, and lay out the bathroom in 3D together, with real toilets, tubs, vanities, tile and paint. It checks clearances as you go and gives a rough estimate at your own labor prices, with a PDF and a materials list you can hand them. It works on a phone or tablet, in English, Spanish or Portuguese.",
        "",
        "Your first 7 days are free, no card needed. After that it's $49.99 a month, and you can cancel any time.",
        "",
        "There's a one-minute video and a live demo here: https://restoration-ai-website-nu.vercel.app",
        "",
        "Happy to walk you through it on a quick call if that's easier.",
        "",
        "Thanks,",
        "Thomas Wright",
        "(801) 580-8630",
        "Wright AI Solutions, LLC",
        "28 E 14 Street, Tempe, AZ 85281",
        `If this isn't for you, just reply "no thanks" and I won't email again.`,
      ].join("\n"),
    );
    expect(body).not.toMatch(/quote|kitchen|Eddy/i);
  });

  it("greets a person by first name when the lead has a separate company", () => {
    const { body } = buildRemodelerOutreachEmail({ name: "Jane Doe", company: "Desert Bath Remodel" });
    expect(body.startsWith("Hey Jane,\n\nI'm Thomas. I built Room Designer 3D for bathroom remodelers like Desert Bath Remodel.")).toBe(
      true,
    );
  });

  it("is what the adapter sends, versioned", () => {
    const pitch = getPipeline("room-designer").buildEmail({ name: "A", company: "A", county: null });
    expect(pitch.templateVersion).toBe(ROOM_DESIGNER_TEMPLATE_VERSION);
    expect(ROOM_DESIGNER_TEMPLATE_VERSION).toMatch(/^room-designer-[0-9a-f]{8}$/);
  });
});

describe("who Room Designer 3D never pitches", () => {
  it.each([
    ["Eddys Remodeling", [], "Thomas's client"],
    ["Eddy's Remodeling LLC", [], "Thomas's client"],
    ["Bath Fitter", [], "a national franchise or big-box installer"],
    ["Re-Bath of Phoenix", [], "a national franchise or big-box installer"],
    ["Five Star Bath Solutions of Mesa", [], "a national franchise or big-box installer"],
    ["Kitchen Tune-Up Tempe", [], "a national franchise or big-box installer"],
    ["The Home Depot", [], "a national franchise or big-box installer"],
    ["Ferguson Plumbing Supply", [], "a supply house or showroom"],
    ["Valley Tile Showroom", [], "a supply house or showroom"],
    ["Valley Plumbing", ["Plumbing"], "a plumber, supply house or showroom, not a remodeler"],
    ["Cabinet Gallery", ["Kitchen & Bath", "Cabinetry"], "a plumber, supply house or showroom, not a remodeler"],
  ])("leaves out %s", (name, categories, reason) => {
    expect(remodelerExclusion({ name, categories })).toBe(reason);
  });

  it("keeps remodelers, including plumbers that also remodel", () => {
    expect(remodelerExclusion({ name: "Desert Bath Remodel", categories: ["Contractors", "Kitchen & Bath"] })).toBeNull();
    expect(remodelerExclusion({ name: "Valley Plumbing & Remodel", categories: ["Plumbing", "Contractors"] })).toBeNull();
    expect(remodelerExclusion({ name: "Saguaro Renovations", categories: [] })).toBeNull();
  });

  it("never emails Eddys Remodeling, even by company or email domain", async () => {
    expect(remodelerPitchExclusion({ name: "Jane Doe", company: "Eddys Remodeling", email: "jane@example.test" })).toBe("Thomas's client");
    expect(remodelerPitchExclusion({ name: "Jane Doe", company: null, email: "info@eddysremodeling.com" })).toBe("Thomas's client");
    liftHold();
    mail = captureMail();
    const lead = await makeRemodelerLead({ name: "Jane Doe", email: "info@eddysremodeling.com" });
    expect(await sendFirstTouch("room-designer", lead.id)).toMatchObject({ ok: false, reason: "blocked" });
    expect(mail.messages).toHaveLength(0);
  });
});

describe("the Room Designer 3D stages", () => {
  it("go Responded → Demo booked → Free week started → Paying customer, and a no is Not interested", () => {
    expect(ROOM_DESIGNER_STATUSES.map(statusLabel)).toEqual([
      "New",
      "Contacted",
      "Responded",
      "Demo booked",
      "Free week started",
      "Paying customer",
      "Not interested",
      "Cold call list",
      "No phone number",
      "Lost",
    ]);
    expect(allowedTransitions("room-designer", "responded")).toEqual(
      expect.arrayContaining(["demo_booked", "free_week", "paying_customer", "not_interested"]),
    );
    expect(allowedTransitions("room-designer", "free_week")).toContain("paying_customer");
  });
});

describe("the Room Designer 3D run", () => {
  it("ships with sending held: the run finds and saves remodelers but emails nobody", async () => {
    expect(ROOM_DESIGNER_SENDING_HELD).toBe(true);
    expect(getPipeline("room-designer").sendHold).toBe(ROOM_DESIGNER_HOLD_MESSAGE);
    mail = captureMail();
    const calls = await stubRemodelerSearch();
    const next = await peekNextRemodelerCity(prisma);

    const outcome = await runDailyRoomDesigner(10, { sendDelayMs: 0, maxCities: 1 });

    expect(outcome.numbers).toMatchObject({ leadsFound: 2, emailsSent: 0 });
    expect(outcome.summary).toMatch(/left out 4 that Room Designer 3D never pitches/);
    expect(mail.messages).toHaveLength(0);
    expect(calls.calls.some((u) => u.includes("bakery"))).toBe(false);
    const leads = await prisma.remodelerLead.findMany({ orderBy: { name: "asc" } });
    expect(leads.map((l) => [l.name, l.email, l.status, l.source])).toEqual([
      ["Desert Bath Remodel", "info@desertbathremodel.test", "new", ROOM_DESIGNER_DAILY_SOURCE],
      ["Saguaro Renovations", "office@saguarorenovations.test", "new", ROOM_DESIGNER_DAILY_SOURCE],
    ]);
    expect(leads[0]!.services).toBe("General Contractor, Bathroom Contractor");
    expect(await prisma.scrapedRemodelerCity.count({ where: { city: next.city, state: next.state } })).toBe(1);
    expect(await prisma.scrapedCity.count()).toBe(0);
  });

  it("emails the remodelers it found once the hold is lifted", async () => {
    liftHold();
    mail = captureMail();
    await stubRemodelerSearch();
    const outcome = await runDailyRoomDesigner(10, { sendDelayMs: 0, maxCities: 1 });
    expect(outcome).toMatchObject({ status: "succeeded", numbers: { leadsFound: 2, emailsSent: 2 } });
    expect(mail.messages.map((m) => m.subject)).toEqual([
      "show your customers their new bathroom in 3D",
      "show your customers their new bathroom in 3D",
    ]);
    expect(await previewBulkSend("room-designer")).toMatchObject({ willSend: 0 });
  });

  it("runs from the weekday cron route, starts on at 10 a day, and is skipped when turned off on the page", async () => {
    mail = captureMail();
    await stubRemodelerSearch();
    expect(await getPipelineSchedule(ROOM_DESIGNER_SCHEDULE_ID)).toEqual({ enabled: true, emailsPerDay: 10 });
    const request = () =>
      new NextRequest("http://localhost/api/cron/room-designer-daily", { headers: { authorization: "Bearer test-cron-secret" } });
    expect((await roomDesignerDailyGET(new NextRequest("http://localhost/api/cron/room-designer-daily"))).status).toBe(401);

    expect((await roomDesignerDailyGET(request())).status).toBe(200);
    const run = await prisma.pipelineRun.findFirstOrThrow({ where: { pipeline: "room-designer", kind: "daily" } });
    expect(run.leadsFound).toBe(2);

    const form = new FormData();
    form.set("emailsPerDay", "5");
    expect(await updateRoomDesignerScheduleAction({}, form)).toMatchObject({ saved: true });
    const skipped = await (await roomDesignerDailyGET(request())).json();
    expect(skipped).toMatchObject({ status: "skipped", summary: "Daily automation is turned off on the Room Designer 3D page." });
  });
});

describe("the Find remodelers buttons", () => {
  it("search the next city or a chosen one, and add a remodeler by hand", async () => {
    await stubRemodelerSearch();
    const next = await runRemodelerScrapeAction();
    expect(next.ok && next.message).toMatch(/added 2 new remodelers/);

    const form = new FormData();
    form.set("city", "Mesa");
    form.set("state", "AZ");
    expect((await searchRemodelersAction({}, form)).message).toMatch(/Found 6 businesses in Mesa, AZ/);

    const blank = { phone: "", address: "", city: "", state: "", website: "", source: "", estimatedValue: "", notes: "" };
    const created = await createRemodelerAction({ ...blank, name: "Jane Doe", company: "Mesa Baths", email: "Jane@MesaBaths.test" });
    expect(created).toMatchObject({ ok: true });
    expect(await prisma.remodelerLead.findUniqueOrThrow({ where: { id: created.leadId! } })).toMatchObject({
      company: "Mesa Baths",
      email: "jane@mesabaths.test",
    });
  });
});
