// The environment's emergency stop (OUTBOUND_EMAIL_DISABLED): with it set,
// every path that can send email refuses, and nothing reaches the mail
// transport — a single send, a bulk send (preview and chunk), the daily
// cron run, and the mail layer itself. The header and Settings pills are
// covered in tests/pages.test.tsx.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { GET as dailyGET } from "@/app/api/cron/vault-daily/route";
import { previewBulkSendAction, sendBulkChunkAction, sendOutreachEmailAction } from "@/lib/actions/outreach";
import { setOutboundPausedAction } from "@/lib/actions/settings";
import { ENV_PAUSED_MESSAGE, OUTBOUND_DISABLED_ENV, OutboundDisabledError, outboundDisabledByEnvironment } from "@/lib/outbound-switch";
import { getAppSettings } from "@/lib/outreach/settings";
import { sendBulkChunk, sendFirstTouch } from "@/lib/outreach/send";
import { sendOutreachEmail } from "@/lib/send-email";
import { DAILY_RUN_SOURCE } from "@/lib/vault-daily-run";
import { captureMail, makeAgentLead, makeColdLead, seedPlaces, stubFetch } from "./helpers";

let mail: ReturnType<typeof captureMail>;
beforeEach(() => {
  mail = captureMail();
  vi.stubEnv(OUTBOUND_DISABLED_ENV, "1");
});
afterEach(() => {
  mail.restore();
  vi.unstubAllEnvs();
});

describe("reading the switch", () => {
  it.each([
    ["1", true],
    ["true", true],
    ["YES", true],
    [" on ", true],
    ["", false],
    ["0", false],
    ["false", false],
    ["off", false],
    [undefined, false],
  ])("%j → %s", (value, expected) => {
    expect(outboundDisabledByEnvironment({ [OUTBOUND_DISABLED_ENV]: value })).toBe(expected);
  });

  it("pauses outbound email whatever the Settings switch says, and says which stop is on", async () => {
    expect(await getAppSettings()).toMatchObject({ outboundPaused: true, pausedBy: "environment", switchPaused: false });
    vi.stubEnv(OUTBOUND_DISABLED_ENV, "");
    expect(await getAppSettings()).toMatchObject({ outboundPaused: false, pausedBy: null });
  });
});

describe("every send path refuses while it is set", () => {
  it("a single send, from the lead page", async () => {
    const lead = await makeColdLead({ email: "one@shop.test" });
    expect(await sendFirstTouch("cold-outreach", lead.id)).toMatchObject({ ok: false, reason: "paused", message: ENV_PAUSED_MESSAGE });
    expect(await sendOutreachEmailAction("cold-outreach", lead.id)).toMatchObject({ ok: false });
    expect(mail.messages).toHaveLength(0);
    expect(await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject({ status: "new", lastEmailedAt: null });
    expect(await prisma.outreachRecipient.count()).toBe(0);
  });

  it("a bulk send: the preview says so, and a chunk already under way stops", async () => {
    const leads = [await makeAgentLead({ email: "a@realty.test" }), await makeAgentLead({ email: "b@realty.test" })];
    const preview = await previewBulkSendAction("dataleadsell");
    expect(preview).toMatchObject({ ok: true, preview: { paused: true, pausedByEnvironment: true } });

    const chunk = await sendBulkChunk(
      "dataleadsell",
      leads.map((l) => l.id),
      { delayMs: 0, chunkSize: 2 },
    );
    expect(chunk).toMatchObject({ sent: 0, stop: "paused", messages: [ENV_PAUSED_MESSAGE] });
    expect(
      await sendBulkChunkAction(
        "dataleadsell",
        leads.map((l) => l.id),
      ),
    ).toMatchObject({ ok: true, result: { sent: 0, stop: "paused" } });
    expect(mail.messages).toHaveLength(0);
  });

  it("the daily cron run: skipped before it searches or sends", async () => {
    await seedPlaces([{ name: "Omega Bakery", phone: "(480) 555-0101", website: "https://www.omegabakery.com" }]);
    const fetchStub = stubFetch({});
    await makeColdLead({ email: "queued@shop.test", source: DAILY_RUN_SOURCE });
    const res = await dailyGET(
      new NextRequest("http://localhost/api/cron/vault-daily", { headers: { authorization: "Bearer test-cron-secret" } }),
    );
    const json = await res.json();
    expect(json).toMatchObject({ status: "skipped" });
    expect(JSON.stringify(json)).toMatch(/OUTBOUND_EMAIL_DISABLED/);
    expect(fetchStub.calls).toEqual([]);
    expect(await prisma.lead.count({ where: { name: "Omega Bakery" } })).toBe(0);
    expect(mail.messages).toHaveLength(0);
  });

  it("the mail layer itself, for any caller that skipped the checks above", async () => {
    await expect(sendOutreachEmail("from@us.test", "to@them.test", "Hi", "Body")).rejects.toBeInstanceOf(OutboundDisabledError);
    expect(mail.messages).toHaveLength(0);
  });

  it("the Settings switch can't undo it, and says why", async () => {
    const result = await setOutboundPausedAction(false);
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.message).toMatch(/OUTBOUND_EMAIL_DISABLED/);
    const lead = await makeColdLead({ email: "still@shop.test" });
    expect(await sendFirstTouch("cold-outreach", lead.id)).toMatchObject({ ok: false, reason: "paused" });
    expect(mail.messages).toHaveLength(0);
  });

  it("sends again once it is unset", async () => {
    vi.stubEnv(OUTBOUND_DISABLED_ENV, "0");
    const lead = await makeColdLead({ email: "back@shop.test" });
    expect(await sendFirstTouch("cold-outreach", lead.id)).toMatchObject({ ok: true });
    expect(mail.to()).toEqual(["back@shop.test"]);
  });
});
