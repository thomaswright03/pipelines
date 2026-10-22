// The daily dataleadsell run: what its "agents to check per run" setting
// yields, that agents it didn't get to are emailed by the next run, that it
// is off until turned on, and how a failed search is handled — the same
// rules as the Cold Outreach run (tests/daily-run.test.ts), on AgentLead.
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { countUnsentDailyAgentLeads, runDailyDataleadsell } from "@/lib/dataleadsell-daily-run";
import { DAILY_RUN_SOURCE } from "@/lib/vault-daily-run";
import { GET as dataleadsellDailyGET } from "@/app/api/cron/dataleadsell-daily/route";
import { DATALEADSELL_SCHEDULE_ID, getPipelineSchedule, savePipelineSchedule, VAULT_SCHEDULE_ID } from "@/lib/pipeline-schedule";
import { updateDataleadsellScheduleAction } from "@/lib/actions/pipeline-schedule";
import { getPipeline } from "@/lib/outreach/pipelines";
import { recentRuns } from "@/lib/outreach/runs";
import { setOutboundPaused } from "@/lib/outreach/settings";
import { DATALEADSELL_SENDER_EMAIL } from "@/lib/dataleadsell-config";
import { captureMail, makeAgentLead, makeColdLead, page, seedPlaces, stubFetch } from "./helpers";

const pad = (n: number) => String(n).padStart(2, "0");

/** Every city lists 50 agents; every fifth one (20%) has a site with their own address on it. */
async function stubFiftyAgents() {
  const agents = Array.from({ length: 50 }, (_, i) => ({ name: `Homes By ${pad(i + 1)}`, phone: `(801) 555-${1000 + i}` }));
  await seedPlaces(agents, { kind: "agent" });
  // Other businesses in the same cities are never searched for agents.
  await seedPlaces([{ name: "Homes By 99 Bakery", website: "https://www.bakery.test" }], { kind: "business" });
  const routes: Parameters<typeof stubFetch>[0] = {};
  for (let n = 5; n <= 50; n += 5) {
    routes[`https://www.homesby${pad(n)}.com`] = page(
      `Homes By ${pad(n)} — call 801-555-${1000 + n - 1} or write to me@homesby${pad(n)}.test`,
    );
  }
  return stubFetch(routes);
}

function cron(auth: string | null = "Bearer test-cron-secret") {
  return dataleadsellDailyGET(
    new NextRequest("http://localhost/api/cron/dataleadsell-daily", { headers: auth === null ? {} : { authorization: auth } }),
  );
}

async function turnOn(agentsPerRun = 10) {
  await savePipelineSchedule(DATALEADSELL_SCHEDULE_ID, { enabled: true, emailsPerDay: agentsPerRun });
}

let mail: ReturnType<typeof captureMail>;
afterEach(() => mail?.restore());

describe("dataleadsell daily run yield", () => {
  it("searches the next agent city for real estate agents, checks them until the day's number is found and emails them", async () => {
    mail = captureMail();
    const fetchStub = await stubFiftyAgents();

    const outcome = await runDailyDataleadsell(2, { sendDelayMs: 0 });

    expect(outcome.status).toBe("succeeded");
    expect(outcome.numbers).toMatchObject({ leadsFound: 2, emailsSent: 2 });
    expect(outcome.summary).toMatch(
      /^Searched .+ \(.+ County, UT\): the business list had 50 agents, checked \d+ for an email, found 2 new addresses, emailed 2, 2 of today's 2 sent\.$/,
    );
    expect(fetchStub.calls.some((u) => u.includes("bakery"))).toBe(false);
    expect(mail.to().sort()).toEqual(["me@homesby05.test", "me@homesby10.test"]);
    expect(mail.messages.every((m) => m.from.includes(DATALEADSELL_SENDER_EMAIL))).toBe(true);
    // Saved as agents, with the daily run's source and the city's county; no Cold Outreach lead was made.
    const saved = await prisma.agentLead.findMany();
    expect(saved).toHaveLength(2);
    expect(saved.every((a) => a.source === DAILY_RUN_SOURCE && a.county && a.state === "UT" && a.status === "contacted")).toBe(true);
    expect(await prisma.lead.count()).toBe(0);
    // The searched city is used up; the next run moves on.
    expect(await prisma.scrapedAgentCity.count()).toBe(1);
  });

  it("checks the whole city when the day needs more than it has", async () => {
    mail = captureMail();
    await stubFiftyAgents();
    const outcome = await runDailyDataleadsell(50, { sendDelayMs: 0 });
    expect(outcome.numbers).toEqual({ businessesChecked: 50, leadsFound: 10, emailsSent: 10 });
  });
});

describe("agents a dataleadsell daily run didn't get to", () => {
  it("are emailed by the next run; hand-added agents and Cold Outreach leads are left alone", async () => {
    mail = captureMail();
    await stubFiftyAgents();
    const manual = await makeAgentLead({ source: "Manual entry" }); // not the daily run's to send
    const cold = await makeColdLead({ source: DAILY_RUN_SOURCE }); // the other pipeline's daily run sends this one

    // Run 1 runs out of time before sending anything.
    const first = await runDailyDataleadsell(2, { sendDelayMs: 0, sendBudgetMs: -1 });
    expect(first.numbers).toMatchObject({ leadsFound: 2, emailsSent: 0 });
    expect(first.summary).toContain("2 left for the next run (out of time)");
    expect(mail.messages).toHaveLength(0);
    expect(await getPipeline("dataleadsell").countSendable(prisma)).toBe(3);
    expect(await countUnsentDailyAgentLeads()).toBe(2);

    // Run 2 has enough waiting, so it searches no city and emails the two left over.
    stubFetch({});
    const second = await runDailyDataleadsell(2, { sendDelayMs: 0 });
    expect(second.summary).toBe(
      "Enough leads were already waiting, so no city was searched, 2 left over from earlier runs, emailed 2, 2 of today's 2 sent.",
    );
    expect(second.numbers).toEqual({ businessesChecked: 0, leadsFound: 0, emailsSent: 2 });
    expect(mail.messages).toHaveLength(2);
    expect(await countUnsentDailyAgentLeads()).toBe(0);
    expect((await prisma.agentLead.findUniqueOrThrow({ where: { id: manual.id } })).status).toBe("new");
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: cold.id } })).status).toBe("new");
  });
});

describe("a dataleadsell daily run whose search fails", () => {
  it("still emails the agents earlier runs found, records the error and is 'partial'", async () => {
    mail = captureMail();
    await turnOn();
    stubFetch({});
    const leftover = await makeAgentLead({ source: DAILY_RUN_SOURCE, createdAt: new Date(Date.now() - 86_400_000) });

    const json = await (await cron()).json();

    expect(json.status).toBe("partial");
    expect(json.summary).toMatch(
      /^Couldn't search .+ in the business list, so no new agents were found, 1 left over from earlier runs, emailed 1, 1 of today's \d+ sent\.$/,
    );
    expect(mail.to()).toEqual([leftover.email]);
    const run = await prisma.pipelineRun.findFirstOrThrow({ where: { pipeline: "dataleadsell", kind: "daily" } });
    expect(run.status).toBe("partial");
    expect(run.errors).toMatch(/^Search of .+ County, UT\) failed: The business list hasn't been loaded yet/);
    // The city wasn't searched, so it stays available for a later run.
    expect(await prisma.scrapedAgentCity.count()).toBe(0);
  });

  it("is 'failed' when the search fails and there is nothing left to email", async () => {
    mail = captureMail();
    stubFetch({});
    const outcome = await runDailyDataleadsell(10, { sendDelayMs: 0 });
    expect(outcome.status).toBe("failed");
    expect(outcome.errors?.[0]).toMatch(/The business list hasn't been loaded yet/);
    expect(mail.messages).toHaveLength(0);
  });
});

describe("the dataleadsell daily schedule", () => {
  it("is off with 10 agents per run until someone saves it; Cold Outreach keeps its own default", async () => {
    expect(await getPipelineSchedule(DATALEADSELL_SCHEDULE_ID)).toEqual({ enabled: false, emailsPerDay: 10 });
    expect(await getPipelineSchedule(VAULT_SCHEDULE_ID)).toEqual({ enabled: true, emailsPerDay: 30 });
  });

  it("is saved by its own action, in agents, without touching Cold Outreach's", async () => {
    const form = (enabled: boolean, count: string) => {
      const f = new FormData();
      if (enabled) f.set("enabled", "on");
      f.set("emailsPerDay", count);
      return f;
    };
    const bad = await updateDataleadsellScheduleAction({}, form(true, "51"));
    expect(bad.error).toBe("Emails to send per day must be a whole number between 1 and 50");
    expect(await getPipelineSchedule(DATALEADSELL_SCHEDULE_ID)).toEqual({ enabled: false, emailsPerDay: 10 });

    expect(await updateDataleadsellScheduleAction({}, form(true, "5"))).toEqual({
      saved: true,
      values: { enabled: true, emailsPerDay: "5" },
    });
    expect(await getPipelineSchedule(DATALEADSELL_SCHEDULE_ID)).toEqual({ enabled: true, emailsPerDay: 5 });
    expect(await prisma.pipelineSchedule.count({ where: { id: VAULT_SCHEDULE_ID } })).toBe(0);
  });
});

describe("the dataleadsell daily cron route", () => {
  it("refuses requests without the exact secret", async () => {
    expect((await cron(null)).status).toBe(401);
    expect((await cron("Bearer nope")).status).toBe(401);
    expect(await prisma.pipelineRun.count()).toBe(0);
  });

  it("is skipped when no schedule has been saved (off by default), and says where to turn it on", async () => {
    mail = captureMail();
    const fetchStub = await stubFiftyAgents();

    const res = await cron();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ status: "skipped", summary: "Daily automation is turned off on the dataleadsell.com page." });
    expect(fetchStub.calls).toHaveLength(0);
    expect(mail.messages).toHaveLength(0);
    expect(await prisma.pipelineRun.findFirstOrThrow()).toMatchObject({ pipeline: "dataleadsell", kind: "daily", status: "skipped" });
  });

  it("is skipped when turned off", async () => {
    mail = captureMail();
    const fetchStub = await stubFiftyAgents();
    await savePipelineSchedule(DATALEADSELL_SCHEDULE_ID, { enabled: false, emailsPerDay: 20 });

    expect(await (await cron()).json()).toMatchObject({ status: "skipped" });
    expect(fetchStub.calls).toHaveLength(0);
    expect(await prisma.agentLead.count()).toBe(0);
  });

  it("is skipped while outbound email is paused", async () => {
    mail = captureMail();
    await stubFiftyAgents();
    await turnOn();
    await setOutboundPaused(true);
    expect(await (await cron()).json()).toMatchObject({ status: "skipped" });
    expect(mail.messages).toHaveLength(0);
  });

  it("runs with the saved number when on, and records the run under dataleadsell only", async () => {
    mail = captureMail();
    await stubFiftyAgents();
    await turnOn(3);

    const res = await cron();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ ok: true, status: "succeeded", numbers: { leadsFound: 3, emailsSent: 3 } });
    expect(mail.messages).toHaveLength(3);
    const run = await prisma.pipelineRun.findFirstOrThrow({ where: { kind: "daily" } });
    expect(run).toMatchObject({ pipeline: "dataleadsell", status: "succeeded", leadsFound: 3, emailsSent: 3 });
    expect(run.summary).toMatch(
      /the business list had 50 agents, checked \d+ for an email, found 3 new addresses, emailed 3, 3 of today's 3 sent\./,
    );
    expect(await recentRuns("dataleadsell", "daily")).toHaveLength(1);
    expect(await recentRuns("cold-outreach", "daily")).toHaveLength(0);
  });

  it("answers 503 with a code and a plain message when the database is down", async () => {
    const outage = Object.assign(new Error("Invalid `prisma.pipelineRun.create()` invocation: Can't reach database server at `db:5432`"), {
      name: "PrismaClientKnownRequestError",
      code: "P1001",
    });
    const create = vi.spyOn(prisma.pipelineRun, "create").mockRejectedValueOnce(outage);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await cron();
      const text = await res.text();
      expect(res.status).toBe(503);
      expect(JSON.parse(text)).toMatchObject({
        ok: false,
        code: "db_unavailable",
        error: expect.stringMatching(/database can't be reached/),
      });
      expect(text).not.toMatch(/prisma|P1001|invocation/i);
      expect(errors.mock.calls.some(([line]) => String(line).startsWith("[api.cron.dataleadsell-daily]"))).toBe(true);
    } finally {
      create.mockRestore();
      errors.mockRestore();
    }
  });
});
