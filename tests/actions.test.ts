// The server actions behind every button and form, called the way the
// pages call them: validation messages, the happy path, and what the
// operator sees when the database or Yelp fails part-way. (next/cache is
// mocked in tests/setup.ts; nothing reaches the network.)
import { DATABASE_UNAVAILABLE_MESSAGE } from "@/lib/db-health";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import * as log from "@/lib/log";
import {
  addSuppressionAction,
  removeSuppressionByEmailAction,
  setAllowCrossPipelineRepeatsAction,
  setOutboundPausedAction,
} from "@/lib/actions/settings";
import { updatePipelineMetaAction } from "@/lib/actions/pipeline-meta";
import { updateVaultScheduleAction } from "@/lib/actions/pipeline-schedule";
import { attachReplyAction, dismissReplyAction, searchLeadsForReplyAction } from "@/lib/actions/replies";
import {
  createLeadAction,
  markLeadLostAction,
  markResponseAsNonDeliveryAction,
  runPipelineScrapeAction,
  scheduleAppointmentAction,
  searchLeadsAction,
  updateLeadAction,
} from "@/lib/actions/vault-pipeline";
import {
  createAgentAction,
  loadAdreRosterAction,
  processAdreChunkAction,
  runAgentPipelineScrapeAction,
  searchAgentsAction,
  updateAgentAction,
} from "@/lib/actions/dataleadsell";
import {
  addLeadActivityAction,
  confirmAddressAction,
  deleteLeadAction,
  dismissReplyReviewAction,
  findEmailsChunkAction,
  markRepliedAction,
  previewBulkSendAction,
  sendBulkChunkAction,
  sendOutreachEmailAction,
  setOurReplyAction,
  setStarredAction,
  updateLeadStatusAction,
} from "@/lib/actions/outreach";
import { getAppSettings } from "@/lib/outreach/settings";
import { getPipeline } from "@/lib/outreach/pipelines";
import { captureMail, makeAgentLead, makeColdLead, page, stubFetch, YELP_PREFIX, yelpResponse } from "./helpers";

const DB_DOWN = new Error("connect ECONNREFUSED 127.0.0.1:5432");

let mail: ReturnType<typeof captureMail> | undefined;
const restorers: (() => void)[] = [];
afterEach(() => {
  mail?.restore();
  mail = undefined;
  while (restorers.length) restorers.pop()!();
  vi.restoreAllMocks();
});

type Model = "appSettings" | "suppressedEmail" | "pipelineMeta" | "pipelineSchedule" | "inboundReply" | "lead" | "adreLicensee";

/**
 * Makes `prisma.<model>.<method>` fail like an unreachable database until
 * the test ends, and keeps the error log quiet. (Prisma's model delegates
 * are proxies, so the delegate is wrapped rather than spied on.)
 */
function dbFails(model: Model, method: string, error: Error = DB_DOWN) {
  vi.spyOn(log, "logError").mockImplementation(() => {});
  const client = prisma as unknown as Record<string, object>;
  const original = client[model]!;
  client[model] = new Proxy(original, {
    get: (target, prop) => (prop === method ? () => Promise.reject(error) : Reflect.get(target, prop)),
  });
  restorers.push(() => {
    client[model] = original;
  });
}

/** Makes one method of a plain object (e.g. a pipeline adapter) fail. */
function failing<T extends object>(target: T, method: keyof T & string) {
  vi.spyOn(log, "logError").mockImplementation(() => {});
  vi.spyOn(target as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>, method).mockRejectedValue(DB_DOWN);
}

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) data.set(k, v);
  return data;
}

const COLD_FORM = {
  name: "",
  company: "",
  email: "",
  phone: "",
  address: "",
  city: "",
  state: "",
  website: "",
  source: "",
  estimatedValue: "",
  notes: "",
};
const AGENT_FORM = { name: "", brokerage: "", email: "", phone: "", city: "", county: "", website: "", notes: "" };

describe("settings actions", () => {
  it("pauses and resumes outbound email", async () => {
    expect(await setOutboundPausedAction(true)).toMatchObject({ ok: true, message: expect.stringMatching(/^Outbound email is paused/) });
    expect((await getAppSettings()).outboundPaused).toBe(true);
    expect(await setOutboundPausedAction(false)).toEqual({ ok: true, message: "Outbound email resumed." });
    expect((await getAppSettings()).outboundPaused).toBe(false);
  });

  it("switches cross-pipeline repeats on and off", async () => {
    expect(await setAllowCrossPipelineRepeatsAction(true)).toMatchObject({ ok: true });
    expect((await getAppSettings()).allowCrossPipelineRepeats).toBe(true);
    expect(await setAllowCrossPipelineRepeatsAction(false)).toMatchObject({
      ok: true,
      message: "Each address now gets at most one pitch across both pipelines.",
    });
  });

  it("says the setting didn't change when saving fails", async () => {
    dbFails("appSettings", "upsert");
    expect(await setOutboundPausedAction(true)).toEqual({
      ok: false,
      error: DATABASE_UNAVAILABLE_MESSAGE,
    });
    expect(await setAllowCrossPipelineRepeatsAction(true)).toMatchObject({ ok: false });
  });

  it("adds and removes do-not-email entries, flagging every lead with the address", async () => {
    const lead = await makeColdLead({ email: "no@thanks.test" });
    expect(await addSuppressionAction("not-an-address", "")).toEqual({
      ok: false,
      error: "Enter a full email address, like name@business.com.",
    });
    expect(await addSuppressionAction(" No@Thanks.test ", "Asked by phone")).toMatchObject({ ok: true });
    expect(await addSuppressionAction("no@thanks.test", "")).toMatchObject({ ok: false, error: expect.stringMatching(/already/) });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).sendBlockedReason).toMatch(/opted out/i);

    expect(await removeSuppressionByEmailAction("no@thanks.test")).toMatchObject({ ok: true });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).sendBlockedReason).toBeNull();
    expect(await removeSuppressionByEmailAction("no@thanks.test")).toMatchObject({ ok: false });
  });

  it("says the list didn't change when the database fails", async () => {
    dbFails("suppressedEmail", "findUnique");
    expect(await addSuppressionAction("a@b.test", "")).toMatchObject({ ok: false, error: DATABASE_UNAVAILABLE_MESSAGE });
    expect(await removeSuppressionByEmailAction("a@b.test")).toMatchObject({ ok: false });
  });
});

describe("dashboard card and schedule actions", () => {
  it("validates and saves a pipeline card", async () => {
    expect(await updatePipelineMetaAction("vault-pipeline", form({ name: " " }))).toEqual({ error: "Pipeline name is required" });
    expect(
      await updatePipelineMetaAction(
        "vault-pipeline",
        form({ name: "Cold Outreach", company: "Wright AI", productDescription: "x", pipelineDescription: "y" }),
      ),
    ).toEqual({});
    expect(await prisma.pipelineMeta.findUniqueOrThrow({ where: { id: "vault-pipeline" } })).toMatchObject({ company: "Wright AI" });

    dbFails("pipelineMeta", "upsert");
    expect(await updatePipelineMetaAction("vault-pipeline", form({ name: "Cold Outreach" }))).toEqual({
      error: DATABASE_UNAVAILABLE_MESSAGE,
    });
  });

  it("validates and saves the daily-run settings", async () => {
    const bad = await updateVaultScheduleAction({}, form({ enabled: "on", businessesPerRun: "" }));
    expect(bad.error).toBeTruthy();
    expect(bad.values).toEqual({ enabled: true, businessesPerRun: "" });

    expect(await updateVaultScheduleAction({}, form({ businessesPerRun: "20" }))).toEqual({
      saved: true,
      values: { enabled: false, businessesPerRun: "20" },
    });
    expect(await prisma.pipelineSchedule.findFirstOrThrow()).toMatchObject({ enabled: false, leadCount: 20 });

    dbFails("pipelineSchedule", "upsert");
    expect((await updateVaultScheduleAction({}, form({ enabled: "on", businessesPerRun: "10" }))).error).toBe(DATABASE_UNAVAILABLE_MESSAGE);
  });
});

describe("unmatched-reply actions", () => {
  it("searches both pipelines, and ignores a query that is too short", async () => {
    await makeColdLead({ name: "Zeta Roofing" });
    await makeAgentLead({ name: "Zed Agent" });
    expect(await searchLeadsForReplyAction("z")).toEqual({ ok: true, leads: [] });
    const found = await searchLeadsForReplyAction("ze");
    expect(found.ok && found.leads.map((l) => l.name).sort()).toEqual(["Zed Agent", "Zeta Roofing"]);

    failing(getPipeline("cold-outreach"), "search");
    expect(await searchLeadsForReplyAction("ze")).toEqual({ ok: false, error: DATABASE_UNAVAILABLE_MESSAGE });
  });

  it("attaches or dismisses a reply, and reports failures plainly", async () => {
    const lead = await makeColdLead({ status: "contacted", lastEmailedAt: new Date() });
    const reply = await prisma.inboundReply.create({
      data: { dedupeKey: "mid:1", fromEmail: "assistant@else.test", optedOut: false, matched: [], text: "Call me" },
    });
    const other = await prisma.inboundReply.create({
      data: { dedupeKey: "mid:2", fromEmail: "x@else.test", optedOut: false, matched: [] },
    });
    expect(await attachReplyAction(reply.id, "cold-outreach", lead.id)).toMatchObject({ ok: true });
    expect(await dismissReplyAction(other.id)).toEqual({ ok: true, message: "Dismissed the reply." });
    expect(await dismissReplyAction(other.id)).toMatchObject({ ok: false });
    expect(await attachReplyAction(reply.id, "nope", lead.id)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Couldn't attach/),
    });

    dbFails("inboundReply", "updateMany");
    expect(await dismissReplyAction(other.id)).toEqual({ ok: false, error: DATABASE_UNAVAILABLE_MESSAGE });
  });
});

describe("Cold Outreach lead actions", () => {
  it("creates a lead with field errors first, then saves it, and refuses an address in use", async () => {
    const bad = await createLeadAction({ ...COLD_FORM, email: "nope" });
    expect(bad.fieldErrors).toMatchObject({ name: "Name is required", email: expect.any(String) });

    const created = await createLeadAction({ ...COLD_FORM, name: "Acme", email: "Owner@Acme.test", estimatedValue: "$1,250.5" });
    expect(created).toMatchObject({ ok: true, leadId: expect.any(String) });
    expect(await prisma.lead.findUniqueOrThrow({ where: { id: created.leadId! } })).toMatchObject({
      email: "owner@acme.test",
      estimatedValueCents: 125050,
      emailEvidence: expect.stringMatching(/^Entered by hand/),
    });

    const dup = await createLeadAction({ ...COLD_FORM, name: "Acme 2", email: "owner@acme.test" });
    expect(dup).toMatchObject({ error: "This email can't be used.", fieldLinks: { email: { href: `/vault-pipeline/${created.leadId}` } } });
  });

  it("updates a lead, and refuses to change a pitched lead's address", async () => {
    const lead = await makeColdLead({ name: "Pitched", email: "a@pitched.test", status: "contacted", lastEmailedAt: new Date() });
    expect((await updateLeadAction(lead.id, { ...COLD_FORM, name: "" })).fieldErrors?.name).toBe("Name is required");
    const moved = await updateLeadAction(lead.id, { ...COLD_FORM, name: "Pitched", email: "b@pitched.test" });
    expect(moved.fieldErrors?.email).toMatch(/already emailed/);
    expect(await updateLeadAction(lead.id, { ...COLD_FORM, name: "Pitched Co", email: "a@pitched.test" })).toEqual({
      ok: true,
      leadId: lead.id,
    });
    expect(await updateLeadAction("missing", { ...COLD_FORM, name: "X" })).toEqual({
      error: "This lead no longer exists — it may have been deleted.",
    });
  });

  it("reports any other failure while saving in general terms", async () => {
    dbFails("lead", "create", new Error("unique constraint violated"));
    expect(await createLeadAction({ ...COLD_FORM, name: "Acme" })).toEqual({
      error: "Something went wrong saving that — nothing was changed. Try again in a moment.",
    });
  });

  it("says the database can't be reached when that's why saving failed", async () => {
    dbFails("lead", "create");
    expect(await createLeadAction({ ...COLD_FORM, name: "Acme" })).toEqual({
      error: DATABASE_UNAVAILABLE_MESSAGE,
    });
  });

  it("searches Yelp for a city, with validation and Yelp outages explained", async () => {
    expect(await searchLeadsAction({}, form({ city: "", state: "AZ", businessType: "" }))).toEqual({ error: "Enter a city" });
    expect(await searchLeadsAction({}, form({ city: "Mesa", state: "Narnia", businessType: "" }))).toEqual({
      error: "State must be a US state, like UT or Utah",
    });

    stubFetch({ [YELP_PREFIX]: () => yelpResponse([]) });
    expect(await searchLeadsAction({}, form({ city: "Mesa", state: "az", businessType: "plumber" }))).toEqual({
      error: "Yelp found no businesses in Mesa, AZ.",
    });

    stubFetch({
      [YELP_PREFIX]: () => yelpResponse([{ name: "Mesa Plumbing", phone: "+14805550111", address: "1 Main St" }]),
      "https://www.mesaplumbing.com": page("Mesa Plumbing, Mesa AZ — (480) 555-0111 — hello@mesaplumbing.test"),
    });
    const found = await searchLeadsAction({}, form({ city: "Mesa", state: "AZ", businessType: "plumber" }));
    expect(found.message).toMatch(/^Found 1 businesses in Mesa, AZ and added 1 new lead/);

    stubFetch({ [YELP_PREFIX]: () => ({ status: 502, body: "bad gateway" }) });
    expect((await searchLeadsAction({}, form({ city: "Mesa", state: "AZ", businessType: "" }))).error).toMatch(/Yelp/);
  });

  it("'Run pipeline' picks the next city and reports what it added", async () => {
    stubFetch({ [YELP_PREFIX]: () => yelpResponse([]) });
    expect(await runPipelineScrapeAction()).toMatchObject({ ok: true, message: expect.stringMatching(/^Found 0 businesses in /) });
    expect(await prisma.scrapedCity.count()).toBe(1);

    stubFetch({ [YELP_PREFIX]: () => ({ status: 500, body: "down" }) });
    expect(await runPipelineScrapeAction()).toMatchObject({ ok: false });
  });

  it("sets an appointment only from a sensible stage and with a date", async () => {
    const lead = await makeColdLead({ status: "responded" });
    expect(await scheduleAppointmentAction(lead.id, "")).toEqual({ ok: false, error: "Pick a date and time for the appointment." });
    expect(await scheduleAppointmentAction(lead.id, "2026-10-01T10:30")).toMatchObject({
      ok: true,
      message: expect.stringMatching(/moved to Appointment set\.$/),
    });
    const fresh = await makeColdLead({ status: "new" });
    expect(await scheduleAppointmentAction(fresh.id, "2026-10-01T10:30")).toMatchObject({ ok: false });
    expect(await scheduleAppointmentAction("missing", "2026-10-01T10:30")).toEqual({ ok: false, error: "This lead no longer exists." });
  });

  it("marks a lead Lost with a reason", async () => {
    const lead = await makeColdLead({ status: "responded" });
    expect(await markLeadLostAction(lead.id, "bored")).toEqual({ ok: false, error: "Pick a reason first." });
    expect(await markLeadLostAction(lead.id, "too_busy")).toEqual({ ok: true, message: `Marked ${lead.name} as Lost (Too busy).` });
    expect(await markLeadLostAction(lead.id, "too_busy")).toMatchObject({ ok: false, error: `${lead.name} is already Lost.` });
  });

  it("turns a 'reply' that was really a bounce notice into a bounce", async () => {
    mail = captureMail();
    const lead = await makeColdLead({ phone: "(480) 555-0100" });
    await sendOutreachEmailAction("cold-outreach", lead.id);
    expect(await markResponseAsNonDeliveryAction(lead.id)).toMatchObject({ ok: false });
    await markRepliedAction("cold-outreach", lead.id);
    expect(await markResponseAsNonDeliveryAction(lead.id)).toEqual({
      ok: true,
      message: `Recorded the bounce for ${lead.name} — moved to Cold call list.`,
    });
    expect(await prisma.leadEmailSendLog.findFirstOrThrow()).toMatchObject({ bounced: true });
  });
});

describe("dataleadsell actions", () => {
  it("creates and updates an agent", async () => {
    expect((await createAgentAction({ ...AGENT_FORM, county: "Pima" })).fieldErrors).toMatchObject({ name: "Name is required" });
    const created = await createAgentAction({ ...AGENT_FORM, name: "Jane Doe", county: "Maricopa", email: "jane@doe.test" });
    expect(created).toMatchObject({ ok: true });
    expect(await prisma.agentLead.findUniqueOrThrow({ where: { id: created.leadId! } })).toMatchObject({ state: "AZ" });
    expect((await createAgentAction({ ...AGENT_FORM, name: "Other", email: "jane@doe.test" })).fieldErrors?.email).toMatch(
      /already belongs/,
    );
    expect(await updateAgentAction(created.leadId!, { ...AGENT_FORM, name: "Jane Q Doe", county: "Salt Lake" })).toMatchObject({
      ok: true,
    });
    expect(await prisma.agentLead.findUniqueOrThrow({ where: { id: created.leadId! } })).toMatchObject({ state: "UT", email: null });
  });

  it("searches Yelp for agents in a sold county", async () => {
    expect(await searchAgentsAction({}, form({ county: "Pima", city: "Tucson" }))).toEqual({
      error: "Pick one of the counties dataleadsell sells",
    });
    expect(await searchAgentsAction({}, form({ county: "Maricopa", city: "Provo" }))).toEqual({ error: "Pick a city in that county" });
    stubFetch({ [YELP_PREFIX]: () => yelpResponse([]) });
    expect(await searchAgentsAction({}, form({ county: "Maricopa", city: "Mesa" }))).toEqual({
      error: "Yelp found no real estate agents in Mesa, AZ.",
    });
    stubFetch({ [YELP_PREFIX]: () => yelpResponse([{ name: "Sam Seller - HomeSmart" }]) });
    expect((await searchAgentsAction({}, form({ county: "Maricopa", city: "Mesa" }))).message).toMatch(
      /^Found 1 agents in Mesa, Maricopa County/,
    );
  });

  it("'Run pipeline' for agents reports Yelp outages", async () => {
    stubFetch({ [YELP_PREFIX]: () => yelpResponse([]) });
    expect(await runAgentPipelineScrapeAction()).toMatchObject({ ok: true });
    stubFetch({ [YELP_PREFIX]: () => ({ status: 503, body: "down" }) });
    expect(await runAgentPipelineScrapeAction()).toMatchObject({ ok: false });
  });

  it("explains an ADRE roster download failure and processes chunks", async () => {
    vi.spyOn(log, "logError").mockImplementation(() => {});
    stubFetch({});
    expect(await loadAdreRosterAction()).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^Couldn't download ADRE's license roster/),
    });
    expect(await processAdreChunkAction()).toMatchObject({ ok: true, result: { checked: 0 } });
    dbFails("adreLicensee", "findMany");
    expect(await processAdreChunkAction()).toMatchObject({ ok: false, error: DATABASE_UNAVAILABLE_MESSAGE });
  });
});

describe("shared lead actions", () => {
  it("refuses an unknown pipeline without touching anything", async () => {
    for (const result of [
      await updateLeadStatusAction("nope", "x", "lost"),
      await setStarredAction("nope", "x", true),
      await deleteLeadAction("nope", "x"),
    ]) {
      expect(result).toEqual({ ok: false, error: "Unknown pipeline." });
    }
  });

  it("stars, records our reply, logs history and deletes", async () => {
    const lead = await makeAgentLead({ status: "responded", repliedAt: new Date() });
    expect(await setStarredAction("dataleadsell", lead.id, true)).toEqual({ ok: true, message: `Starred ${lead.name}.` });
    expect(await setOurReplyAction("dataleadsell", lead.id, true)).toMatchObject({ ok: true });
    expect(await setOurReplyAction("dataleadsell", lead.id, false)).toMatchObject({ ok: true });
    expect(await dismissReplyReviewAction("dataleadsell", lead.id)).toMatchObject({ ok: true });
    expect(await addLeadActivityAction("dataleadsell", lead.id, "note", "  ")).toEqual({ ok: false, error: "Write what happened first." });
    expect(await addLeadActivityAction("dataleadsell", lead.id, "fax", "hi")).toEqual({ ok: false, error: "Pick an entry type." });
    expect(await addLeadActivityAction("dataleadsell", lead.id, "meeting", "Coffee at 3")).toMatchObject({ ok: true });
    expect(await prisma.agentLeadActivity.count({ where: { leadId: lead.id } })).toBe(1);
    expect(await confirmAddressAction("dataleadsell", lead.id)).toMatchObject({ ok: false });
    expect(await deleteLeadAction("dataleadsell", lead.id)).toEqual({ ok: true, message: `Deleted ${lead.name}.` });
    expect(await deleteLeadAction("dataleadsell", lead.id)).toMatchObject({ ok: false });
  });

  it("turns an unexpected failure into a plain message", async () => {
    const lead = await makeColdLead();
    failing(getPipeline("cold-outreach"), "findLead");
    expect(await setStarredAction("cold-outreach", lead.id, true)).toEqual({
      ok: false,
      error: DATABASE_UNAVAILABLE_MESSAGE,
    });
  });

  it("previews and sends a bulk batch, and sweeps for missing emails", async () => {
    mail = captureMail();
    await makeColdLead();
    await makeColdLead();
    const preview = await previewBulkSendAction("cold-outreach");
    expect(preview).toMatchObject({ ok: true, preview: { willSend: 2 } });
    const ids = (await prisma.lead.findMany({ select: { id: true } })).map((l) => l.id);
    // The page sends one lead per call, so Stop takes effect between emails.
    for (const id of ids) expect(await sendBulkChunkAction("cold-outreach", [id])).toMatchObject({ ok: true });
    expect(mail.messages).toHaveLength(2);
    expect(await previewBulkSendAction("nope")).toMatchObject({ ok: false });
    expect(await sendBulkChunkAction("nope", [])).toEqual({ ok: false, error: "Unknown pipeline." });
    expect(await findEmailsChunkAction("nope")).toEqual({ ok: false, error: "Unknown pipeline." });

    stubFetch({});
    await makeColdLead({ email: null, name: "No Site Co" });
    expect(await findEmailsChunkAction("cold-outreach")).toMatchObject({ ok: true, result: { checked: 1, found: 0, remaining: 0 } });
  });
});
