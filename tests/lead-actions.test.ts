import { describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { confirmColdCallAction, markRepliedAction, setOurReplyAction, updateLeadStatusAction } from "@/lib/actions/outreach";
import { scheduleAppointmentAction } from "@/lib/actions/vault-pipeline";
import { updateVaultScheduleAction } from "@/lib/actions/pipeline-schedule";
import { getPipelineSchedule, VAULT_SCHEDULE_ID } from "@/lib/pipeline-schedule";
import { addSuppressionAction, removeSuppressionByEmailAction } from "@/lib/actions/settings";
import { getPipeline } from "@/lib/outreach/pipelines";
import { makeAgentLead, makeColdLead, makeHaulerLead } from "./helpers";

function scheduleForm(enabled: boolean, emailsPerDay: string) {
  const data = new FormData();
  if (enabled) data.set("enabled", "on");
  data.set("emailsPerDay", emailsPerDay);
  return data;
}

describe("status changes", () => {
  it("rejects a status that doesn't exist", async () => {
    const lead = await makeColdLead();
    expect(await updateLeadStatusAction("cold-outreach", lead.id, "banana")).toEqual({
      ok: false,
      error: `"banana" isn't a status in this pipeline.`,
    });
    expect(await updateLeadStatusAction("cold-outreach", lead.id, "subscribed")).toMatchObject({ ok: false });
    expect(await updateLeadStatusAction("nope", lead.id, "lost")).toEqual({ ok: false, error: "Unknown pipeline." });
  });

  it("rejects moves the stage machine doesn't allow, naming both stages", async () => {
    const lead = await makeColdLead({ name: "Zed", status: "new" });
    expect(await updateLeadStatusAction("cold-outreach", lead.id, "paying_client")).toEqual({
      ok: false,
      error: "Zed can't move from New to Paying client.",
    });
    expect(await updateLeadStatusAction("cold-outreach", lead.id, "contacted")).toMatchObject({ ok: false });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("new");
  });

  it("allows 'undo Mark replied' only for a lead that was actually emailed", async () => {
    const emailed = await makeAgentLead({ name: "Emailed", status: "responded", repliedAt: new Date() });
    await prisma.emailSendLog.create({ data: { leadId: emailed.id, email: emailed.email! } });
    const never = await makeAgentLead({ name: "Never", status: "responded" });

    expect(await updateLeadStatusAction("dataleadsell", emailed.id, "contacted")).toEqual({
      ok: true,
      message: "Moved Emailed from Responded to Contacted.",
    });
    expect((await prisma.agentLead.findUniqueOrThrow({ where: { id: emailed.id } })).repliedAt).toBeNull();
    expect(await updateLeadStatusAction("dataleadsell", never.id, "contacted")).toEqual({
      ok: false,
      error: "Never was never emailed, so they can't go back to Contacted.",
    });
  });

  it("says exactly what each action did, and refuses ones that don't fit", async () => {
    const lead = await makeColdLead({ name: "Yara", status: "new" });
    expect(await markRepliedAction("cold-outreach", lead.id)).toEqual({
      ok: false,
      error: "Yara is New — only a lead waiting on a reply can be marked replied.",
    });
    expect(await setOurReplyAction("cold-outreach", lead.id, true)).toEqual({
      ok: false,
      error: "Yara hasn't replied yet, so there's nothing to answer.",
    });
    expect(await updateLeadStatusAction("cold-outreach", lead.id, "lost", "too_busy")).toEqual({
      ok: true,
      message: "Moved Yara from New to Lost (Too busy).",
    });
  });
});

describe("appointments", () => {
  it("stores 10:00 AM Arizona time as 17:00 UTC", async () => {
    const lead = await makeColdLead({ name: "Appt", status: "responded" });
    const result = await scheduleAppointmentAction(lead.id, "2026-10-01T10:00");
    expect(result).toEqual({
      ok: true,
      message: "Appointment with Appt set for Oct 1, 2026, 10:00 AM MST — moved to Appointment set.",
    });
    const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after.appointmentAt?.toISOString()).toBe("2026-10-01T17:00:00.000Z");
    expect(after.status).toBe("appointment_set");
  });
});

describe("cold-call deck", () => {
  it("records each outcome per pipeline and refuses leads no longer on the list", async () => {
    const cold = await makeColdLead({ name: "Cold One", status: "cold_call_list" });
    const agent = await makeAgentLead({ name: "Agent One", status: "cold_call_list" });

    expect(await confirmColdCallAction("cold-outreach", cold.id, "maybe", "")).toEqual({
      ok: false,
      error: "Pick a call outcome first.",
    });
    expect(await confirmColdCallAction("cold-outreach", cold.id, "no_answer", "")).toMatchObject({ ok: true });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: cold.id } })).status).toBe("cold_call_list");

    expect(await confirmColdCallAction("dataleadsell", agent.id, "not_interested", "")).toMatchObject({ ok: true });
    expect((await prisma.agentLead.findUniqueOrThrow({ where: { id: agent.id } })).status).toBe("not_interested");
    expect(await confirmColdCallAction("dataleadsell", agent.id, "interested", "")).toEqual({
      ok: false,
      error: "Agent One is no longer on the cold-call list (now Not interested).",
    });
  });
});

describe("daily automation settings", () => {
  it("explains an out-of-range count and keeps the old value", async () => {
    const result = await updateVaultScheduleAction({}, scheduleForm(true, "500"));
    expect(result.error).toBe("Emails to send per day must be a whole number between 1 and 50");
    expect(result.values).toEqual({ enabled: true, emailsPerDay: "500" });
    expect(await getPipelineSchedule(VAULT_SCHEDULE_ID)).toEqual({ enabled: true, emailsPerDay: 30 });
  });

  it("caps a count saved before the 50-business limit at what Yelp can return", async () => {
    await prisma.pipelineSchedule.create({ data: { id: VAULT_SCHEDULE_ID, enabled: true, leadCount: 100 } });
    expect(await getPipelineSchedule(VAULT_SCHEDULE_ID)).toEqual({ enabled: true, emailsPerDay: 50 });
  });

  it("saves enabled and businesses-per-run", async () => {
    expect(await updateVaultScheduleAction({}, scheduleForm(false, "12"))).toMatchObject({ saved: true });
    expect(await getPipelineSchedule(VAULT_SCHEDULE_ID)).toEqual({ enabled: false, emailsPerDay: 12 });
  });
});

describe("manual moves never overwrite a change made meanwhile", () => {
  it("refuses when the status changed between reading the lead and saving, and keeps the newer status", async () => {
    const lead = await makeColdLead({ name: "Racy", status: "contacted", lastEmailedAt: new Date() });
    const pipeline = getPipeline("cold-outreach");
    const stale = (await pipeline.findLead(prisma, lead.id))!;
    // A reply lands after the page loaded the lead, before the save.
    await prisma.lead.update({ where: { id: lead.id }, data: { status: "responded", repliedAt: new Date() } });

    for (const attempt of [
      () => updateLeadStatusAction("cold-outreach", lead.id, "lost", "not_interested"),
      () => updateLeadStatusAction("cold-outreach", lead.id, "cold_call_list"),
      () => scheduleAppointmentAction(lead.id, "2030-01-02T10:00"),
    ]) {
      const spy = vi.spyOn(pipeline, "findLead").mockResolvedValueOnce(stale);
      const result = await attempt();
      spy.mockRestore();
      expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/changed status a moment ago/) });
    }
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("responded");
  });

  it("Lost follows the stage machine", async () => {
    const lead = await makeColdLead({ name: "Lossy", status: "lost" });
    expect(await updateLeadStatusAction("cold-outreach", lead.id, "lost", "no_need")).toEqual({
      ok: true,
      message: "Lossy is already Lost.",
    });
  });

  it("sends a no to Not interested, not Lost, in the pipelines that have that stage", async () => {
    const agent = await makeAgentLead({ name: "Saidno Agent", status: "contacted", lastEmailedAt: new Date() });
    expect(await updateLeadStatusAction("dataleadsell", agent.id, "lost", "not_interested")).toEqual({
      ok: false,
      error: "Saidno Agent said no, so move them to Not interested instead of Lost.",
    });
    expect((await prisma.agentLead.findUniqueOrThrow({ where: { id: agent.id } })).status).toBe("contacted");
    const hauler = await makeHaulerLead({ name: "Saidno Hauling", status: "contacted", lastEmailedAt: new Date() });
    expect(await updateLeadStatusAction("garbage-ai", hauler.id, "lost", "not_interested")).toMatchObject({ ok: false });
    // Any other reason is still a Lost.
    expect(await updateLeadStatusAction("garbage-ai", hauler.id, "lost", "no_answer")).toMatchObject({ ok: true });
    expect(await prisma.haulerLead.findUniqueOrThrow({ where: { id: hauler.id } })).toMatchObject({
      status: "lost",
      callOutcome: "no_answer",
    });
  });
});

describe("do-not-email list in Settings", () => {
  it("adds an address (flagging its leads), finds and removes it", async () => {
    const lead = await makeColdLead({ email: "asked@phone.test" });

    expect(await addSuppressionAction("Asked@Phone.test", "Asked by phone")).toMatchObject({ ok: true });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).sendBlockedReason).toMatch(/^Opted out/);
    expect(await addSuppressionAction("asked@phone.test", "")).toMatchObject({ ok: false });
    expect(await addSuppressionAction("not an address", "")).toMatchObject({ ok: false });

    expect(await removeSuppressionByEmailAction("asked@phone.test")).toMatchObject({ ok: true });
    expect(await prisma.suppressedEmail.count()).toBe(0);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).sendBlockedReason).toBeNull();
  });
});
