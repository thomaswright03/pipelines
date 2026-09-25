import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { GET as dailyGET } from "@/app/api/cron/vault-daily/route";
import { GET as staleGET } from "@/app/api/cron/stale-contacts/route";
import { setOutboundPaused } from "@/lib/outreach/settings";
import { savePipelineSchedule, VAULT_SCHEDULE_ID } from "@/lib/pipeline-schedule";
import { captureMail, makeAgentLead, makeColdLead, page, smtpError, stubFetch, YELP_PREFIX, yelpResponse } from "./helpers";

function cron(handler: typeof dailyGET, auth: string | null = "Bearer test-cron-secret") {
  return handler(
    new NextRequest("http://localhost/api/cron/x", { headers: auth === null ? {} : { authorization: auth } }),
  );
}

// Two Yelp listings for one bakery (same inbox) plus one more business.
function stubYelpCity() {
  return stubFetch({
    [YELP_PREFIX]: () =>
      yelpResponse([
        { name: "Omega Bakery", phone: "+14805550101" },
        { name: "Omega Bakery Downtown", phone: "+14805550102" },
        { name: "Zeta Roofing", phone: "+14805550103" },
      ]),
    "https://www.omegabakery.com": page(`(480) 555-0101 <a href="mailto:hello@omegabakery.test">Email</a>`),
    "https://www.omegabakerydowntown.com": page(`Our downtown shop, (480) 555-0102: hello@omegabakery.test`),
    "https://www.zetaroofing.com": page(`Zeta Roofing 480-555-0103 owner@zetaroofing.test`),
  });
}

let mail: ReturnType<typeof captureMail>;
afterEach(() => mail?.restore());

describe("cron authentication", () => {
  it("refuses requests without the exact secret", async () => {
    expect((await cron(dailyGET, null)).status).toBe(401);
    expect((await cron(dailyGET, "Bearer undefined")).status).toBe(401);
    expect((await cron(staleGET, "Bearer nope")).status).toBe(401);
  });

  it("refuses everything when CRON_SECRET is unset", async () => {
    const saved = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {
      expect((await cron(dailyGET, "Bearer undefined")).status).toBe(401);
    } finally {
      process.env.CRON_SECRET = saved;
    }
  });
});

describe("daily Cold Outreach run", () => {
  it("discovers, dedupes by address, sends one message per inbox, and records the run", async () => {
    mail = captureMail();
    stubYelpCity();

    const res = await cron(dailyGET);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status).toBe("succeeded");
    expect(mail.to().sort()).toEqual(["hello@omegabakery.test", "owner@zetaroofing.test"]);
    expect(await prisma.lead.count()).toBe(2);
    expect((await prisma.lead.findFirstOrThrow({ where: { name: "Zeta Roofing" } })).phone).toBe("(480) 555-0103");
    const run = await prisma.pipelineRun.findFirstOrThrow({ where: { kind: "daily" } });
    expect(run).toMatchObject({ status: "succeeded", pipeline: "cold-outreach" });
    expect(run.summary).toMatch(/Yelp listed 3 businesses, checked 3 for an email, found 2 new addresses, emailed 2/);
    expect(run).toMatchObject({ businessesChecked: 3, leadsFound: 2, emailsSent: 2 });
  });

  it("is skipped (and says so) when automation is turned off", async () => {
    mail = captureMail();
    const fetchStub = stubYelpCity();
    await savePipelineSchedule(VAULT_SCHEDULE_ID, { enabled: false, businessesPerRun: 30 });

    const json = await (await cron(dailyGET)).json();

    expect(json).toMatchObject({ status: "skipped" });
    expect(fetchStub.calls).toHaveLength(0);
    expect(mail.messages).toHaveLength(0);
    expect((await prisma.pipelineRun.findFirstOrThrow()).summary).toMatch(/turned off/);
  });

  it("is skipped while outbound email is paused", async () => {
    mail = captureMail();
    stubYelpCity();
    await setOutboundPaused(true);
    expect(await (await cron(dailyGET)).json()).toMatchObject({ status: "skipped" });
    expect(mail.messages).toHaveLength(0);
  });

  it("records an SMTP outage as a failed run with the reason", async () => {
    mail = captureMail();
    mail.fail(smtpError("connect ECONNREFUSED 127.0.0.1:587", { code: "ESOCKET", syscall: "connect" }));
    stubYelpCity();

    const res = await cron(dailyGET);

    expect(res.status).toBe(500);
    const run = await prisma.pipelineRun.findFirstOrThrow({ where: { kind: "daily" } });
    expect(run.status).toBe("failed");
    expect(run.errors).toContain("Couldn't reach the email service — nothing was sent.");
    expect(await prisma.lead.count({ where: { status: "new" } })).toBe(2);
  });

  it("records a Yelp outage with nothing left to send as a failed run with a readable cause", async () => {
    mail = captureMail();
    stubFetch({ [YELP_PREFIX]: () => ({ status: 502, body: "<html>502 Bad Gateway</html>" }) });
    const json = await (await cron(dailyGET)).json();
    expect(json.status).toBe("failed");
    expect(json.errors[0]).toContain("Yelp isn't responding right now");
  });
});

describe("stale-contact routing", () => {
  it("moves week-old contacted leads in both pipelines to phone outreach", async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 86_400_000);
    const agent = await makeAgentLead({ status: "contacted", lastEmailedAt: eightDaysAgo, phone: "(480) 555-0101" });
    const agentNoPhone = await makeAgentLead({ status: "contacted", lastEmailedAt: eightDaysAgo, phone: null });
    const cold = await makeColdLead({ status: "contacted", lastEmailedAt: eightDaysAgo, phone: "(480) 555-0102" });
    const fresh = await makeColdLead({ status: "contacted", lastEmailedAt: new Date() });

    const json = await (await cron(staleGET)).json();

    expect(json.status).toBe("succeeded");
    expect((await prisma.agentLead.findUniqueOrThrow({ where: { id: agent.id } })).status).toBe("cold_call_list");
    expect((await prisma.agentLead.findUniqueOrThrow({ where: { id: agentNoPhone.id } })).status).toBe("contactless_list");
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: cold.id } })).status).toBe("cold_call_list");
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe("contacted");
  });
});
