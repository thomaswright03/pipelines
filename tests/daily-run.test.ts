// What the daily Cold Outreach run actually does with its "businesses to
// check per run" setting, and that leads it didn't get to are emailed by
// the next run.
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { runDailyColdOutreach } from "@/lib/vault-daily-run";
import { getPipeline } from "@/lib/outreach/pipelines";
import { captureMail, makeColdLead, page, stubFetch, YELP_PREFIX, yelpResponse } from "./helpers";

const pad = (n: number) => String(n).padStart(2, "0");

/** Yelp lists 50 businesses; every fifth one (20%) has a site with an address on it. */
function stubYelpFifty() {
  const businesses = Array.from({ length: 50 }, (_, i) => ({ name: `Shop ${pad(i + 1)}`, phone: `+1480555${1000 + i}` }));
  const routes: Parameters<typeof stubFetch>[0] = { [YELP_PREFIX]: () => yelpResponse(businesses) };
  for (let n = 5; n <= 50; n += 5) {
    routes[`https://www.shop${pad(n)}.com`] = page(`Shop ${pad(n)} — write to owner@shop${pad(n)}.test`);
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
