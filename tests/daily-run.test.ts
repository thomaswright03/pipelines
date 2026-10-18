// What the daily Cold Outreach runs actually do with the "emails to send
// per day" setting, and that leads a run didn't get to are emailed by the
// next run.
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { countUnsentDailyLeads, runDailyColdOutreach } from "@/lib/vault-daily-run";
import { markCityUsed, peekNextCity, pickNextCity } from "@/lib/vault-city-picker";
import { markAgentCityUsed, peekNextAgentCity, pickNextAgentCity } from "@/lib/agent-city-picker";
import { getPipeline } from "@/lib/outreach/pipelines";
import { displayRunStatus } from "@/lib/outreach/runs";
import { GET as dailyGET } from "@/app/api/cron/vault-daily/route";
import { NextRequest } from "next/server";
import { YELP_SHAPE_CHANGED } from "@/lib/yelp-discovery";
import { getConnectionStatus } from "@/lib/integration-status";
import { captureMail, makeColdLead, page, stubFetch, YELP_PREFIX, yelpResponse } from "./helpers";

const pad = (n: number) => String(n).padStart(2, "0");

/** Yelp lists 50 businesses; every fifth one (20%) has a site with an address on it. */
function stubYelpFifty() {
  const businesses = Array.from({ length: 50 }, (_, i) => ({ name: `Shop ${pad(i + 1)}`, phone: `+1480555${1000 + i}` }));
  const routes: Parameters<typeof stubFetch>[0] = { [YELP_PREFIX]: () => yelpResponse(businesses) };
  for (let n = 5; n <= 50; n += 5) {
    routes[`https://www.shop${pad(n)}.com`] = page(`Shop ${pad(n)} — call 480-555-${1000 + n - 1} or write to owner@shop${pad(n)}.test`);
  }
  return stubFetch(routes);
}

let mail: ReturnType<typeof captureMail>;
afterEach(() => mail?.restore());

describe("daily run yield", () => {
  it("checks businesses until it has found the day's number, and emails them", async () => {
    mail = captureMail();
    stubYelpFifty();

    const outcome = await runDailyColdOutreach(6, { sendDelayMs: 0 });

    expect(outcome.numbers).toMatchObject({ leadsFound: 6, emailsSent: 6 });
    // Every fifth business has an address: the sixth is the 30th. A few lookups already under way may finish too.
    expect(outcome.numbers!.businessesChecked).toBeGreaterThanOrEqual(30);
    expect(outcome.numbers!.businessesChecked).toBeLessThan(40);
    expect(mail.messages).toHaveLength(6);
    expect(outcome.summary).toMatch(
      /Yelp listed 50 businesses, checked \d+ for an email, found 6 new addresses, emailed 6, 6 of today's 6 sent\./,
    );
  });

  it("checks the whole city when the day needs more than it has", async () => {
    mail = captureMail();
    stubYelpFifty();
    const outcome = await runDailyColdOutreach(30, { sendDelayMs: 0, maxCities: 1 });
    expect(outcome.numbers).toEqual({ businessesChecked: 50, leadsFound: 10, emailsSent: 10 });
    expect(outcome.summary).toContain("10 of today's 30 sent.");
  });

  it("does nothing once the day's number is sent, counting emails sent by hand", async () => {
    mail = captureMail();
    const { calls } = stubYelpFifty();
    for (let i = 0; i < 3; i++) {
      const lead = await makeColdLead({ name: `By hand ${i}`, email: `hand${i}@shop.test` });
      await prisma.leadEmailSendLog.create({ data: { leadId: lead.id, email: lead.email! } });
    }

    const outcome = await runDailyColdOutreach(3, { sendDelayMs: 0 });

    expect(outcome.status).toBe("skipped");
    expect(outcome.summary).toMatch(/^Already sent 3 emails today, which meets the daily number \(3\)/);
    expect(calls).toHaveLength(0);
    expect(mail.messages).toHaveLength(0);
  });

  it("only sends what the day still needs", async () => {
    mail = captureMail();
    stubYelpFifty();
    const lead = await makeColdLead({ name: "Earlier today", email: "earlier@shop.test" });
    await prisma.leadEmailSendLog.create({ data: { leadId: lead.id, email: lead.email! } });

    const outcome = await runDailyColdOutreach(4, { sendDelayMs: 0 });

    expect(outcome.numbers).toMatchObject({ leadsFound: 3, emailsSent: 3 });
    expect(outcome.summary).toContain("4 of today's 4 sent.");
  });
});

describe("leads a daily run didn't get to", () => {
  it("are emailed by the next run, and the page's 'not yet emailed' count follows", async () => {
    mail = captureMail();
    stubYelpFifty();
    const manual = await makeColdLead({ source: "Added by hand" }); // not the daily run's to send

    // Run 1 runs out of time before sending anything.
    const first = await runDailyColdOutreach(6, { sendDelayMs: 0, sendBudgetMs: -1 });
    expect(first.numbers).toMatchObject({ leadsFound: 6, emailsSent: 0 });
    expect(first.summary).toContain("6 left for the next run (out of time)");
    expect(mail.messages).toHaveLength(0);
    expect(await getPipeline("cold-outreach").countSendable(prisma)).toBe(7);
    // The page tells the hand-added one apart: only the six are the daily run's to send.
    expect(await countUnsentDailyLeads()).toBe(6);

    // Run 2 has enough waiting, so it searches no city and emails the six left over.
    const { calls } = stubFetch({ [YELP_PREFIX]: () => yelpResponse([]) });
    const second = await runDailyColdOutreach(6, { sendDelayMs: 0 });
    expect(second.summary).toBe(
      "Enough leads were already waiting, so no city was searched, 6 left over from earlier runs, emailed 6, 6 of today's 6 sent.",
    );
    expect(calls).toHaveLength(0);
    expect(second.numbers).toEqual({ businessesChecked: 0, leadsFound: 0, emailsSent: 6 });
    expect(mail.messages).toHaveLength(6);
    expect(await getPipeline("cold-outreach").countSendable(prisma)).toBe(1);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: manual.id } })).status).toBe("new");
  });

  it("retries a lead whose send failed with nothing sent", async () => {
    mail = captureMail();
    mail.fail(Object.assign(new Error("connect ECONNREFUSED"), { code: "ESOCKET", syscall: "connect" }));
    stubYelpFifty();
    const first = await runDailyColdOutreach(2, { sendDelayMs: 0 });
    expect(first.status).toBe("failed");
    expect(await prisma.lead.count({ where: { status: "new" } })).toBe(2);

    mail.restore();
    mail = captureMail();
    stubFetch({ [YELP_PREFIX]: () => yelpResponse([]) });
    const second = await runDailyColdOutreach(2, { sendDelayMs: 0 });
    expect(second.numbers?.emailsSent).toBe(2);
    expect(await prisma.lead.count({ where: { status: "contacted" } })).toBe(2);
  });
});

describe("a daily run whose Yelp search fails", () => {
  it("still emails the leads earlier runs found, records the Yelp error and is 'partial'", async () => {
    mail = captureMail();
    stubFetch({ [YELP_PREFIX]: () => ({ status: 502, body: "<html>502 Bad Gateway</html>" }) });
    const leftover = await makeColdLead({
      source: "Yelp search (daily automated run)",
      address: "1 Main St, Phoenix, AZ 85001",
      createdAt: new Date(Date.now() - 86_400_000),
    });

    const res = await dailyGET(
      new NextRequest("http://localhost/api/cron/vault-daily", { headers: { authorization: "Bearer test-cron-secret" } }),
    );
    const json = await res.json();

    expect(mail.messages).toHaveLength(1);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: leftover.id } })).status).toBe("contacted");
    expect(json.status).toBe("partial");
    expect(json.summary).toMatch(
      /^Couldn't search .+, so no new leads were found, 1 left over from earlier runs, emailed 1, 1 of today's 30 sent\.$/,
    );
    const run = await prisma.pipelineRun.findFirstOrThrow({ where: { kind: "daily" } });
    expect(run.status).toBe("partial");
    expect(run.errors).toMatch(/^Search of .+ failed: Yelp wasn't responding, so no new leads were found/);
    // The city wasn't searched, so it stays available for a later run.
    expect(await prisma.scrapedCity.count()).toBe(0);
  });

  it("names a change in Yelp's response shape in the run log and in Settings → Connections", async () => {
    mail = captureMail();
    stubFetch({ [YELP_PREFIX]: () => ({ contentType: "application/json", body: JSON.stringify({ businesses: {} }) }) });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await dailyGET(
      new NextRequest("http://localhost/api/cron/vault-daily", { headers: { authorization: "Bearer test-cron-secret" } }),
    );

    expect((await res.json()).status).toBe("failed");
    const run = await prisma.pipelineRun.findFirstOrThrow({ where: { kind: "daily" } });
    expect(run.errors).toContain(YELP_SHAPE_CHANGED);
    const yelp = (await getConnectionStatus(process.env, new Date())).find((c) => c.key === "yelp");
    expect(yelp).toMatchObject({ tone: "error", summary: expect.stringContaining("Yelp's response changed") });
    expect(errors.mock.calls.some(([line]) => /\[yelp\.search\] .*Unexpected response shape — businesses:/.test(String(line)))).toBe(true);
    expect(await prisma.scrapedCity.count()).toBe(0);
  });

  it("is 'failed' when the search fails and there is nothing left to email", async () => {
    mail = captureMail();
    stubFetch({ [YELP_PREFIX]: () => ({ status: 502, body: "<html>502 Bad Gateway</html>" }) });
    const outcome = await runDailyColdOutreach(10, { sendDelayMs: 0 });
    expect(outcome.status).toBe("failed");
    expect(outcome.errors?.[0]).toMatch(/Yelp wasn't responding, so no new leads were found/);
    expect(mail.messages).toHaveLength(0);
  });

  it("tells the operator what happens next when Yelp can't be reached, not to 'try again'", async () => {
    mail = captureMail();
    stubFetch({
      [YELP_PREFIX]: () => {
        throw new TypeError("fetch failed");
      },
    });
    const outcome = await runDailyColdOutreach(10, { sendDelayMs: 0 });
    const error = outcome.errors?.[0] ?? "";
    expect(error).toMatch(/Couldn't reach Yelp, so no new leads were found this time/);
    expect(error).toMatch(/The next daily run tries again automatically; if this happens two days in a row, tell your developer\.$/);
    expect(error).not.toMatch(/Check the connection|try again\./);
  });
});

describe("the daily run's time budget", () => {
  it("never starts a lookup or a send whose worst case would run past the limit, and reports the rest as deferred", async () => {
    // A fake clock: every page fetch takes 5 s and every send 20 s (the
    // SMTP worst case). The run must still be done by 55 s.
    let clock = 0;
    const now = () => clock;
    const businesses = Array.from({ length: 10 }, (_, i) => ({ name: `Slow ${pad(i + 1)}`, phone: `+1480555${2000 + i}` }));
    const routes: Parameters<typeof stubFetch>[0] = { [YELP_PREFIX]: () => yelpResponse(businesses) };
    for (let n = 1; n <= 10; n++) {
      routes[`https://www.slow${pad(n)}.com`] = () => {
        clock += 5_000;
        return page(`Slow ${pad(n)} — 480-555-${2000 + n - 1} — hi@slow${pad(n)}.test`);
      };
    }
    stubFetch(routes);
    mail = captureMail();
    const original = mail.messages.push.bind(mail.messages);
    mail.messages.push = (...items) => {
      clock += 20_000;
      return original(...items);
    };
    // Three leads left over from earlier runs are queued first.
    for (let i = 0; i < 3; i++) {
      await makeColdLead({ source: "Yelp search (daily automated run)", createdAt: new Date(Date.now() - 86_400_000) });
    }

    // The 60 s budgets dataleadsell and Garbage AI run with.
    const outcome = await runDailyColdOutreach(10, { sendDelayMs: 0, now, discoveryBudgetMs: 25_000, sendBudgetMs: 55_000, maxCities: 1 });

    expect(clock).toBeLessThanOrEqual(55_000);
    expect(outcome.status).toBe("succeeded");
    // Discovery ran while a lookup fit before 25 s; sends while one fit before 55 s.
    expect(outcome.numbers!.businessesChecked).toBeLessThan(10);
    expect(outcome.summary).toMatch(/stopped early: out of time/);
    expect(outcome.summary).toMatch(/left for the next run \(out of time\)/);
    expect(mail.messages.length).toBe(outcome.numbers!.emailsSent);
  });
});

describe("Cold Outreach's once-a-day run", () => {
  it("searches more cities until the day's number is found, and sends it all within its 300 s", async () => {
    // Every Yelp search lists the same 4 businesses, but the phone numbers
    // differ per search so each city's are new; each page fetch takes 5 s
    // and each send 3 s.
    let clock = 0;
    const now = () => clock;
    let search = 0;
    const routes: Parameters<typeof stubFetch>[0] = {
      [YELP_PREFIX]: () => {
        search++;
        return yelpResponse(
          Array.from({ length: 4 }, (_, i) => ({ name: `Town${search} ${pad(i + 1)}`, phone: `+1480556${search}${i}00` })),
        );
      },
    };
    for (let c = 1; c <= 6; c++) {
      for (let n = 1; n <= 4; n++) {
        routes[`https://www.town${c}${pad(n)}.com`] = () => {
          clock += 5_000;
          return page(`Town${c} ${pad(n)} — 480-556-${c}${n - 1}00 — hi@town${c}${pad(n)}.test`);
        };
      }
    }
    stubFetch(routes);
    mail = captureMail();
    const original = mail.messages.push.bind(mail.messages);
    mail.messages.push = (...items) => {
      clock += 3_000;
      return original(...items);
    };

    const outcome = await runDailyColdOutreach(10, { sendDelayMs: 0, now });

    expect(search).toBeGreaterThan(1);
    expect(outcome.numbers!.emailsSent).toBe(10);
    expect(outcome.summary).toMatch(/10 of today's 10 sent/);
    expect(clock).toBeLessThanOrEqual(285_000);
  });
});

describe("the daily run's status", () => {
  it("is 'succeeded' (HTTP 200) when the only queued lead was skipped because its address was already pitched", async () => {
    mail = captureMail();
    stubFetch({ [YELP_PREFIX]: () => yelpResponse([]) });
    await prisma.outreachRecipient.create({ data: { pipeline: "dataleadsell", email: "dup@x.test", state: "sent", sentAt: new Date() } });
    await makeColdLead({ email: "dup@x.test", source: "Yelp search (daily automated run)" });

    const res = await dailyGET(
      new NextRequest("http://localhost/api/cron/vault-daily", { headers: { authorization: "Bearer test-cron-secret" } }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status).toBe("succeeded");
    expect(json.summary).toContain("1 skipped by the send rules");
    expect(json.errors[0]).toMatch(/^Skipped Business \d+: dup@x.test was already pitched/);
    expect(mail.messages).toHaveLength(0);
  });

  it("a run left 'running' past the time limit shows as interrupted", async () => {
    const now = new Date();
    expect(displayRunStatus({ status: "running", startedAt: new Date(now.getTime() - 10 * 60_000) }, now)).toBe("interrupted");
    expect(displayRunStatus({ status: "running", startedAt: new Date(now.getTime() - 30_000) }, now)).toBe("running");
    expect(displayRunStatus({ status: "failed", startedAt: new Date(0) }, now)).toBe("failed");
  });
});

describe("the next city", () => {
  it("is shown before searching, and is the one searched; a used city moves the preview on", async () => {
    const shown = await peekNextCity(prisma);
    const picked = await pickNextCity(prisma);
    expect({ city: picked.city, state: picked.state }).toEqual(shown);
    await markCityUsed(prisma, picked.city, picked.state);
    expect(await peekNextCity(prisma)).not.toEqual(shown);

    const agentShown = await peekNextAgentCity(prisma);
    const agentPicked = await pickNextAgentCity(prisma);
    expect({ city: agentPicked.city, county: agentPicked.county, state: agentPicked.state }).toEqual(agentShown);
    await markAgentCityUsed(prisma, agentPicked.city, agentPicked.county, agentPicked.state);
    expect(await peekNextAgentCity(prisma)).not.toEqual(agentShown);
  });
});
