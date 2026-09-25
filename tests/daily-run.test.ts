// What the daily Cold Outreach run actually does with its "businesses to
// check per run" setting, and that leads it didn't get to are emailed by
// the next run.
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { runDailyColdOutreach } from "@/lib/vault-daily-run";
import { getPipeline } from "@/lib/outreach/pipelines";
import { displayRunStatus } from "@/lib/outreach/runs";
import { GET as dailyGET } from "@/app/api/cron/vault-daily/route";
import { NextRequest } from "next/server";
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
  it("checks exactly the configured number of businesses and reports what it found and emailed", async () => {
    mail = captureMail();
    stubYelpFifty();

    const outcome = await runDailyColdOutreach(30, { sendDelayMs: 0 });

    expect(outcome.numbers).toEqual({ businessesChecked: 30, leadsFound: 6, emailsSent: 6 });
    expect(mail.messages).toHaveLength(6);
    expect(outcome.summary).toMatch(/Yelp listed 50 businesses, checked 30 for an email, found 6 new addresses, emailed 6\./);
  });

  it("checks all 50 at the maximum setting", async () => {
    mail = captureMail();
    stubYelpFifty();
    const outcome = await runDailyColdOutreach(50, { sendDelayMs: 0 });
    expect(outcome.numbers).toEqual({ businessesChecked: 50, leadsFound: 10, emailsSent: 10 });
  });
});

describe("leads a daily run didn't get to", () => {
  it("are emailed by the next run, and the page's 'not yet emailed' count follows", async () => {
    mail = captureMail();
    stubYelpFifty();
    const manual = await makeColdLead({ source: "Added by hand" }); // not the daily run's to send

    // Run 1 runs out of time before sending anything.
    const first = await runDailyColdOutreach(30, { sendDelayMs: 0, sendBudgetMs: -1 });
    expect(first.numbers).toEqual({ businessesChecked: 30, leadsFound: 6, emailsSent: 0 });
    expect(first.summary).toContain("6 left for the next run (out of time)");
    expect(mail.messages).toHaveLength(0);
    expect(await getPipeline("cold-outreach").countSendable(prisma)).toBe(7);

    // Run 2 finds nothing new in its city but emails the six left over.
    stubFetch({ [YELP_PREFIX]: () => yelpResponse([]) });
    const second = await runDailyColdOutreach(30, { sendDelayMs: 0 });
    expect(second.summary).toContain("6 left over from earlier runs, emailed 6");
    expect(second.numbers).toEqual({ businessesChecked: 0, leadsFound: 0, emailsSent: 6 });
    expect(mail.messages).toHaveLength(6);
    expect(await getPipeline("cold-outreach").countSendable(prisma)).toBe(1);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: manual.id } })).status).toBe("new");
  });

  it("retries a lead whose send failed with nothing sent", async () => {
    mail = captureMail();
    mail.fail(Object.assign(new Error("connect ECONNREFUSED"), { code: "ESOCKET", syscall: "connect" }));
    stubYelpFifty();
    const first = await runDailyColdOutreach(10, { sendDelayMs: 0 });
    expect(first.status).toBe("failed");
    expect(await prisma.lead.count({ where: { status: "new" } })).toBe(2);

    mail.restore();
    mail = captureMail();
    stubFetch({ [YELP_PREFIX]: () => yelpResponse([]) });
    const second = await runDailyColdOutreach(10, { sendDelayMs: 0 });
    expect(second.numbers?.emailsSent).toBe(2);
    expect(await prisma.lead.count({ where: { status: "contacted" } })).toBe(2);
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

    const outcome = await runDailyColdOutreach(10, { sendDelayMs: 0, now });

    expect(clock).toBeLessThanOrEqual(55_000);
    expect(outcome.status).toBe("succeeded");
    // Discovery ran while a lookup fit before 25 s; sends while one fit before 55 s.
    expect(outcome.numbers!.businessesChecked).toBeLessThan(10);
    expect(outcome.summary).toMatch(/stopped early: out of time/);
    expect(outcome.summary).toMatch(/left for the next run \(out of time\)/);
    expect(mail.messages.length).toBe(outcome.numbers!.emailsSent);
  });
});

describe("the daily run's status", () => {
  it("is 'succeeded' (HTTP 200) when the only queued lead was skipped because its address was already pitched", async () => {
    mail = captureMail();
    stubFetch({ [YELP_PREFIX]: () => yelpResponse([]) });
    await prisma.outreachRecipient.create({ data: { pipeline: "dataleadsell", email: "dup@x.test", state: "sent", sentAt: new Date() } });
    await makeColdLead({ email: "dup@x.test", source: "Yelp search (daily automated run)" });

    const res = await dailyGET(new NextRequest("http://localhost/api/cron/vault-daily", { headers: { authorization: "Bearer test-cron-secret" } }));
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
