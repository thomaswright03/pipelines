// The Garbage AI pipeline: its pitch, who it never pitches, where it never
// searches, that its daily run finds and emails haulers, and that every
// send path refuses while sending is held.
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { buildHaulerOutreachEmail, GARBAGE_AI_TEMPLATE_VERSION, haulerGreetingName } from "@/lib/garbage-ai-email-template";
import { GARBAGE_AI_HOLD_MESSAGE } from "@/lib/garbage-ai-config";
import { haulerExclusion, isMountainHighCity, MOUNTAIN_HIGH_CITIES } from "@/lib/garbage-ai-targeting";
import { markHaulerCityUsed, peekNextHaulerCity, pickNextHaulerCity } from "@/lib/garbage-ai-city-picker";
import { GARBAGE_AI_DAILY_SOURCE, runDailyGarbageAi } from "@/lib/garbage-ai-daily-run";
import { runHaulerScrapeAction, searchHaulersAction, createHaulerAction, updateHaulerAction } from "@/lib/actions/garbage-ai";
import { updateGarbageAiScheduleAction } from "@/lib/actions/pipeline-schedule";
import { GET as garbageDailyGET } from "@/app/api/cron/garbage-ai-daily/route";
import { getPipelineSchedule, GARBAGE_AI_SCHEDULE_ID } from "@/lib/pipeline-schedule";
import { previewBulkSend, sendBulkChunk, sendFirstTouch } from "@/lib/outreach/send";
import { getPipeline } from "@/lib/outreach/pipelines";
import { allowedTransitions, coldCallResult, GARBAGE_AI_STATUSES, statusLabel } from "@/lib/lead-status";
import { US_CITIES } from "@/lib/us-cities";
import { setOutboundPaused } from "@/lib/outreach/settings";
import { OUTBOUND_DISABLED_ENV } from "@/lib/outbound-switch";
import { captureMail, makeHaulerLead, page, smtpError, stubFetch, YELP_PREFIX } from "./helpers";

type Route = { status?: number; body: string; contentType?: string };

type YelpBusiness = { name: string; phone?: string; address?: string; categories?: string[] };

function yelpHaulers(businesses: YelpBusiness[]): Route {
  return {
    contentType: "application/json",
    body: JSON.stringify({
      businesses: businesses.map((b) => ({
        name: b.name,
        phone: b.phone ?? "",
        location: { display_address: (b.address ?? "1 Main St, Phoenix, AZ 85001").split(", ") },
        categories: (b.categories ?? ["Garbage Collection"]).map((title) => ({ alias: title.toLowerCase(), title })),
      })),
    }),
  };
}

/** A Yelp answer with two sendable haulers and one of each kind Garbage AI never pitches. */
function stubHaulerSearch() {
  const calls = stubFetch({
    [YELP_PREFIX]: () =>
      yelpHaulers([
        { name: "Desert Roll Off", phone: "+14805551001", categories: ["Dumpster Rental", "Garbage Collection"] },
        { name: "Saguaro Hauling", phone: "+14805551002" },
        { name: "Waste Management", phone: "+14805551003" },
        { name: "City of Phoenix Public Works", phone: "+14805551004" },
        { name: "Mountain High Disposal", phone: "+14805551005" },
        { name: "Front Range Hauling", phone: "+19705551006", address: "9 Elm St, Greeley, CO 80631" },
      ]),
    "https://www.desertrolloff.com": page("Desert Roll Off — call 480-555-1001 or email office@desertrolloff.test"),
    "https://www.saguarohauling.com": page("Saguaro Hauling — 480-555-1002 — info@saguarohauling.test"),
  });
  return calls;
}

let mail: ReturnType<typeof captureMail> | undefined;
afterEach(() => mail?.restore());

describe("the Garbage AI pitch", () => {
  it("greets a hauler known only by its business name with 'Hi there,' and has no link while the signup site isn't live", () => {
    const { subject, body } = buildHaulerOutreachEmail({ name: "Desert Roll Off", company: "Desert Roll Off" });
    expect(subject).toBe("Who's texting back your 9pm leads?");
    expect(body.startsWith("Hi there,\n\nA homeowner fills out your form at 9pm.")).toBe(true);
    expect(body).toContain("A hauler in Colorado runs it today.");
    expect(body).not.toContain("Mountain High");
    expect(body).toContain("Max Garrett, who runs it with them, will walk you through it.");
    expect(body).not.toContain("Or take a look first");
    expect(body).not.toMatch(/\$|\d+ new customers/);
    expect(body).toContain("Thomas Wright\n(385) 306-8041\nWright AI Solutions, LLC\n28 E 14 Street, Tempe, AZ 85281\n\n");
    expect(body.endsWith("Don't want to hear from us again? Reply STOP and we won't email you again.")).toBe(true);
  });

  it("uses a person's first name only when the lead has a separate company", () => {
    expect(haulerGreetingName("Jane Doe", "Desert Roll Off")).toBe("Jane");
    expect(haulerGreetingName("Desert Roll Off", "Desert Roll Off")).toBeNull();
    expect(haulerGreetingName("Desert Roll Off", null)).toBeNull();
    expect(buildHaulerOutreachEmail({ name: "Jane Doe", company: "Desert Roll Off" }).body.startsWith("Hi Jane,")).toBe(true);
  });

  it("drops Mountain High's name, and adds the signup link, brand and phone, when those are set", () => {
    const { body } = buildHaulerOutreachEmail(
      { name: "X", company: null },
      { nameReferenceCustomer: false, signupUrl: "https://example.test", brand: "Kaizen Marketing", phone: "(555) 000-1111" },
    );
    expect(body).toContain("A hauler in Colorado runs it today.");
    expect(body).toContain("who runs it with them, will walk you through it.");
    expect(body).not.toContain("Mountain High");
    expect(body).toContain("Just reply with a time that works.\n\nOr take a look first: https://example.test\n\nThomas Wright");
    expect(body).toContain("(555) 000-1111\nKaizen Marketing\n28 E 14 Street, Tempe, AZ 85281\nhttps://example.test\n");
  });

  it("is what the adapter sends, versioned", () => {
    const pitch = getPipeline("garbage-ai").buildEmail({ name: "A", company: "A", county: null });
    expect(pitch.templateVersion).toBe(GARBAGE_AI_TEMPLATE_VERSION);
    expect(GARBAGE_AI_TEMPLATE_VERSION).toMatch(/^garbage-ai-[0-9a-f]{8}$/);
  });
});

describe("who Garbage AI never pitches", () => {
  it.each([
    ["Mountain High Disposal", "already a client"],
    ["Eastern Waste & Recycling", "already a client"],
    ["Garden State Bin Cleaning LLC", "already a client"],
    ["WM", "national or large regional hauler"],
    ["WM of Arizona", "national or large regional hauler"],
    ["Republic Services", "national or large regional hauler"],
    ["GFL Environmental", "national or large regional hauler"],
    ["Waste Pro USA", "national or large regional hauler"],
    ["City of Tucson Environmental Services", "a city or county department"],
    ["Maricopa County Solid Waste", "a city or county department"],
    ["Public Works Department", "a city or county department"],
  ])("leaves out %s (%s)", (name, reason) => {
    expect(haulerExclusion({ name, address: null })).toBe(reason);
  });

  it("leaves out a hauler in Mountain High's service area, and keeps everyone else", () => {
    expect(haulerExclusion({ name: "Front Range Hauling", address: "9 Elm St, Greeley, CO 80631" })).toBe(
      "in Mountain High's service area",
    );
    expect(haulerExclusion({ name: "Peak Hauling", address: "9 Elm St, Colorado Springs, CO 80903" })).toBeNull();
    expect(haulerExclusion({ name: "Swarm Hauling", address: "1 Main St, Mesa, AZ 85201" })).toBeNull();
    expect(haulerExclusion({ name: "ABC Sanitation", address: null })).toBeNull();
  });

  it("never picks a Mountain High city as the day's city", async () => {
    expect(MOUNTAIN_HIGH_CITIES).toHaveLength(32);
    expect(isMountainHighCity("Fort Collins", "CO")).toBe(true);
    expect(isMountainHighCity("fort collins", "co")).toBe(true);
    expect(isMountainHighCity("Aurora", "IL")).toBe(false);
    const pool = US_CITIES.filter((c) => !isMountainHighCity(c.city, c.state));
    for (const c of pool) await markHaulerCityUsed(prisma, c.city, c.state);
    // Every allowed city is used: the pool starts over, still without Mountain High's.
    const next = await pickNextHaulerCity(prisma);
    expect(next.poolReset).toBe(true);
    expect(isMountainHighCity(next.city, next.state)).toBe(false);
    expect(await peekNextHaulerCity(prisma)).toEqual({ city: next.city, state: next.state });
  });
});

describe("the daily Garbage AI run", () => {
  it("finds and saves haulers, leaves out the ones it never pitches, and emails the new ones", async () => {
    mail = captureMail();
    const calls = stubHaulerSearch();
    const next = await peekNextHaulerCity(prisma);

    const outcome = await runDailyGarbageAi(30, { sendDelayMs: 0 });

    expect(outcome.status).toBe("succeeded");
    expect(outcome.numbers).toEqual({ businessesChecked: 2, leadsFound: 2, emailsSent: 2 });
    expect(outcome.summary).toMatch(/Yelp listed 6 businesses, left out 4 that Garbage AI never pitches/);
    expect(outcome.summary).toMatch(/emailed 2/);
    expect(mail.messages).toHaveLength(2);
    expect(mail.messages[0]!.subject).toBe("Who's texting back your 9pm leads?");
    expect(calls.calls.find((u) => u.startsWith(YELP_PREFIX))).toContain("term=garbage+collection");

    const haulers = await prisma.haulerLead.findMany({ orderBy: { name: "asc" } });
    expect(haulers.map((h) => [h.name, h.company, h.email, h.status, h.source])).toEqual([
      ["Desert Roll Off", "Desert Roll Off", "office@desertrolloff.test", "contacted", GARBAGE_AI_DAILY_SOURCE],
      ["Saguaro Hauling", "Saguaro Hauling", "info@saguarohauling.test", "contacted", GARBAGE_AI_DAILY_SOURCE],
    ]);
    expect(haulers[0]!.services).toBe("Dumpster Rental, Garbage Collection");
    expect(await prisma.scrapedHaulerCity.count({ where: { city: next.city, state: next.state } })).toBe(1);
    // Cold Outreach's city pool is untouched.
    expect(await prisma.scrapedCity.count()).toBe(0);
  });

  it("skips a hauler whose address Cold Outreach already pitched", async () => {
    mail = captureMail();
    stubHaulerSearch();
    await prisma.outreachRecipient.create({ data: { pipeline: "cold-outreach", email: "info@saguarohauling.test", state: "sent" } });
    const outcome = await runDailyGarbageAi(30, { sendDelayMs: 0 });
    expect(outcome.numbers?.leadsFound).toBe(1);
    expect(await prisma.haulerLead.count({ where: { email: "info@saguarohauling.test" } })).toBe(0);
    expect(mail.messages.map((m) => m.to)).not.toContain("info@saguarohauling.test");
  });

  it("records a failed search and doesn't use up the city", async () => {
    stubFetch({ [YELP_PREFIX]: () => ({ status: 500, body: "{}" }) });
    const outcome = await runDailyGarbageAi(30, { sendDelayMs: 0 });
    expect(outcome.status).toBe("failed");
    expect(outcome.errors?.[0]).toMatch(/^Search of .+ failed:/);
    expect(outcome.summary).toMatch(/^Couldn't search .+ on Yelp, so no new haulers were found, emailed 0\.$/);
    expect(await prisma.scrapedHaulerCity.count()).toBe(0);
  });

  it("reports send outcomes like the other daily runs: a refused address, a failed send, and a run where every send failed", async () => {
    mail = captureMail();
    stubFetch({ [YELP_PREFIX]: () => yelpHaulers([]) });
    const old = new Date(Date.now() - 86_400_000);
    await makeHaulerLead({ name: "Bad Address Hauling", email: "nobody@bad.test", source: GARBAGE_AI_DAILY_SOURCE, createdAt: old });
    await makeHaulerLead({ name: "Good Hauling", email: "office@good.test", source: GARBAGE_AI_DAILY_SOURCE });
    mail.refuse("nobody@bad.test");

    const refused = await runDailyGarbageAi(30, { sendDelayMs: 0 });
    // A refused address is that lead's problem, not a failed run.
    expect(refused.status).toBe("succeeded");
    expect(refused.summary).toMatch(/2 left over from earlier runs, emailed 1, 1 address refused by the recipient's mail server\.$/);

    await makeHaulerLead({ name: "Down Hauling", email: "office@down.test", source: GARBAGE_AI_DAILY_SOURCE });
    mail.fail(smtpError("connect ECONNREFUSED 127.0.0.1:587", { code: "ESOCKET", syscall: "connect" }));
    const failed = await runDailyGarbageAi(30, { sendDelayMs: 0 });
    // Nothing went out: failed, as for Cold Outreach and dataleadsell.
    expect(failed.status).toBe("failed");
    expect(failed.summary).toMatch(/emailed 0, 1 failed to send\.$/);
  });

  it("runs from the cron route, and is skipped when turned off on the page", async () => {
    mail = captureMail();
    stubHaulerSearch();
    const request = () =>
      new NextRequest("http://localhost/api/cron/garbage-ai-daily", { headers: { authorization: "Bearer test-cron-secret" } });
    expect((await garbageDailyGET(new NextRequest("http://localhost/api/cron/garbage-ai-daily"))).status).toBe(401);

    const res = await garbageDailyGET(request());
    expect(res.status).toBe(200);
    const run = await prisma.pipelineRun.findFirstOrThrow({ where: { pipeline: "garbage-ai", kind: "daily" } });
    expect(run.status).toBe("succeeded");
    expect(run.leadsFound).toBe(2);

    const form = new FormData();
    form.set("businessesPerRun", "20"); // "enabled" unchecked
    expect(await updateGarbageAiScheduleAction({}, form)).toMatchObject({ saved: true });
    expect(await getPipelineSchedule(GARBAGE_AI_SCHEDULE_ID)).toEqual({ enabled: false, businessesPerRun: 20 });
    const skipped = await (await garbageDailyGET(request())).json();
    expect(skipped).toMatchObject({ ok: true, status: "skipped", summary: "Daily automation is turned off on the Garbage AI page." });
  });

  it.each([
    ["the Settings pause", "Outbound email is paused, so the daily run didn't search or send."],
    [
      "the server's OUTBOUND_EMAIL_DISABLED switch",
      "Sending is switched off by whoever manages the app's hosting, so the daily run didn't search or send. (For your developer: OUTBOUND_EMAIL_DISABLED is set.)",
    ],
  ])("is skipped by %s: no search, no lookups, no sends", async (stop, summary) => {
    mail = captureMail();
    const calls = stubHaulerSearch();
    await makeHaulerLead({ email: "queued@hauler.test", source: GARBAGE_AI_DAILY_SOURCE });
    if (stop === "the Settings pause") await setOutboundPaused(true);
    else vi.stubEnv(OUTBOUND_DISABLED_ENV, "1");
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });

    const res = await garbageDailyGET(
      new NextRequest("http://localhost/api/cron/garbage-ai-daily", { headers: { authorization: "Bearer test-cron-secret" } }),
    );
    expect(await res.json()).toMatchObject({ ok: true, status: "skipped", summary });
    expect(calls.calls).toEqual([]);
    expect(mail.messages).toHaveLength(0);
    expect(await prisma.scrapedHaulerCity.count()).toBe(0);
    expect(await prisma.haulerLead.count()).toBe(1);
  });
});

describe("the Find haulers buttons", () => {
  it("search the next city, or a chosen one, and refuse Mountain High's area", async () => {
    stubHaulerSearch();
    const next = await runHaulerScrapeAction();
    expect(next).toMatchObject({ ok: true });
    expect(next.ok && next.message).toMatch(/added 2 new haulers/);

    const form = new FormData();
    form.set("city", "Greeley");
    form.set("state", "CO");
    expect(await searchHaulersAction({}, form)).toEqual({
      error: "Greeley, CO is in Mountain High Disposal's service area, so Garbage AI doesn't search there.",
    });

    form.set("city", "Mesa");
    form.set("state", "AZ");
    const chosen = await searchHaulersAction({}, form);
    expect(chosen.message).toMatch(/Found 6 businesses in Mesa, AZ and added 0 new haulers \(skipped 2 already in the list\)/);
  });

  it("add and edit a hauler by hand", async () => {
    const blank = { phone: "", address: "", city: "", state: "", website: "", source: "", estimatedValue: "", notes: "" };
    const created = await createHaulerAction({ ...blank, name: "Jane Doe", company: "Desert Roll Off", email: "Jane@DesertRollOff.test" });
    expect(created).toMatchObject({ ok: true });
    const lead = await prisma.haulerLead.findUniqueOrThrow({ where: { id: created.leadId! } });
    expect(lead).toMatchObject({ company: "Desert Roll Off", email: "jane@desertrolloff.test", source: "Manual entry" });

    const updated = await updateHaulerAction(lead.id, { ...blank, name: "Jane Doe", company: "Desert Roll Off LLC", email: lead.email! });
    expect(updated).toMatchObject({ ok: true });
    expect((await prisma.haulerLead.findUniqueOrThrow({ where: { id: lead.id } })).company).toBe("Desert Roll Off LLC");
  });
});

describe("sending", () => {
  it("sends the pitch to a hauler", async () => {
    mail = captureMail();
    const lead = await makeHaulerLead();
    expect(await sendFirstTouch("garbage-ai", lead.id)).toMatchObject({ ok: true });
    expect(mail.messages).toHaveLength(1);
    expect((await prisma.haulerLead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("contacted");
  });

  it("never emails Mountain High Disposal, even one added by hand under another name, email or address", async () => {
    mail = captureMail();
    const byName = await makeHaulerLead({ name: "Mountain High Disposal LLC", email: "a@example.test" });
    const byCompany = await makeHaulerLead({ name: "Jane Doe", company: "Mountain High Disposal", email: "b@example.test" });
    const byDomain = await makeHaulerLead({ name: "Jane Roe", email: "office@mountainhighdisposal.com" });
    const byCity = await makeHaulerLead({ name: "Front Range Hauling", email: "c@example.test", city: "Greeley", state: "CO" });
    for (const lead of [byName, byCompany, byDomain, byCity]) {
      expect(await sendFirstTouch("garbage-ai", lead.id)).toMatchObject({ ok: false, reason: "blocked" });
    }
    expect((await sendFirstTouch("garbage-ai", byName.id)).message).toBe(
      "Mountain High Disposal LLC is never emailed by Garbage AI (already a client) — nothing was sent.",
    );

    const preview = await previewBulkSend("garbage-ai");
    expect(preview).toMatchObject({ willSend: 0, skipped: { neverPitch: 4 } });
    expect(mail.messages).toHaveLength(0);
    expect(await prisma.outreachRecipient.count()).toBe(0);
  });

  it("while held, refuses a single send and a bulk send, and the daily run emails nobody", async () => {
    mail = captureMail();
    const adapter = getPipeline("garbage-ai") as { sendHold: string | null };
    adapter.sendHold = GARBAGE_AI_HOLD_MESSAGE;
    onTestFinished(() => {
      adapter.sendHold = null;
    });
    const lead = await makeHaulerLead();

    const single = await sendFirstTouch("garbage-ai", lead.id);
    expect(single).toMatchObject({ ok: false, reason: "paused", message: GARBAGE_AI_HOLD_MESSAGE });

    const bulk = await sendBulkChunk("garbage-ai", [lead.id], { delayMs: 0 });
    expect(bulk.stop).toBe("paused");
    expect(bulk.sent).toBe(0);

    expect(mail.messages).toHaveLength(0);
    expect(await prisma.outreachRecipient.count()).toBe(0);
    expect((await prisma.haulerLead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("new");

    stubHaulerSearch();
    const run = await runDailyGarbageAi(30, { sendDelayMs: 0 });
    expect(run.numbers?.emailsSent).toBe(0);
    expect(run.summary).toMatch(/sending is on hold, so nobody was emailed\.$/);
    expect(mail.messages).toHaveLength(0);
  });
});

describe("Garbage AI stages", () => {
  it("names its own stages, and a no goes to Not interested", () => {
    expect(GARBAGE_AI_STATUSES.map(statusLabel)).toEqual([
      "New",
      "Contacted",
      "Responded",
      "Demo booked",
      "Signed up",
      "Paying client",
      "Not interested",
      "Cold call list",
      "No phone number",
      "Lost",
    ]);
    expect(allowedTransitions("garbage-ai", "responded")).toContain("demo_booked");
    expect(allowedTransitions("garbage-ai", "demo_booked")).toContain("signed_up");
    expect(coldCallResult("garbage-ai", "not_interested")).toEqual({ callOutcome: "not_interested", status: "not_interested" });
  });

  it("are exactly what the database allows", async () => {
    const [row] = await prisma.$queryRaw<{ def: string }[]>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'HaulerLead_status_check'`;
    const allowed = [...(row?.def ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!).sort();
    expect(allowed).toEqual([...GARBAGE_AI_STATUSES].sort());
    const lead = await makeHaulerLead();
    await expect(prisma.$executeRaw`UPDATE "HaulerLead" SET status = 'appointment_set' WHERE id = ${lead.id}`).rejects.toThrow(
      /HaulerLead_status_check/,
    );
  });
});
