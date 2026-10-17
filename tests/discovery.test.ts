import { describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { createLeadsFromCandidates, findEmailForLead, type DiscoveryCandidate } from "@/lib/outreach/discovery";
import { getPipeline } from "@/lib/outreach/pipelines";
import { suppressEmail } from "@/lib/email-suppression";
import { makeAgentLead, page, stubFetch } from "./helpers";

const ctx = { city: "Mesa", state: "AZ", county: "Maricopa", source: "test", maxCreate: 10, deadline: Number.POSITIVE_INFINITY };

function agent(name: string, brokerage: string | null, phone: string | null = null): DiscoveryCandidate {
  return { name, brokerage, phone, address: null, website: null };
}

describe("agent discovery (dataleadsell)", () => {
  it("never saves an agent with the brokerage's shared inbox", async () => {
    stubFetch({ "https://www.kellerwilliams.com": page(`Keller Williams — call us! frontdesk@kellerwilliams.test`) });

    const result = await createLeadsFromCandidates("dataleadsell", [agent("Jane Doe", "Keller Williams")], ctx);

    expect(result.created).toHaveLength(0);
    expect(result.skipped.noEmail).toBe(1);
    expect(await prisma.agentLead.count()).toBe(0);
  });

  it("saves the agent's own address from the brokerage site, with a normalised phone", async () => {
    stubFetch({
      "https://www.kellerwilliams.com": page(`Keller Williams Mesa team: frontdesk@kellerwilliams.test, jane.doe@kellerwilliams.test`),
    });

    const result = await createLeadsFromCandidates("dataleadsell", [agent("Jane Doe", "Keller Williams", "+14805550188")], ctx);

    expect(result.created.map((c) => c.email)).toEqual(["jane.doe@kellerwilliams.test"]);
    const saved = await prisma.agentLead.findFirstOrThrow();
    expect(saved).toMatchObject({ phone: "(480) 555-0188", county: "Maricopa", state: "AZ", email: "jane.doe@kellerwilliams.test" });
  });

  it("reads the brokerage out of 'Name - Brokerage' listings", async () => {
    stubFetch({ "https://www.homesmart.com": page(`HomeSmart: info@homesmart.test`) });
    const result = await createLeadsFromCandidates("dataleadsell", [agent("Pat Lee - HomeSmart", null)], ctx);
    expect(result.created).toHaveLength(0);
  });

  it("skips an address already held by another lead or on the do-not-email list", async () => {
    await makeAgentLead({ name: "Existing", email: "sam@samsellshomes.test" });
    await suppressEmail("opt@optoutrealty.test", { reason: "t", source: "manual" });
    stubFetch({
      "https://www.samsellshomes.com": { body: `<title>Sam Sells Homes</title>Sam sells homes in Mesa: sam@samsellshomes.test` },
      "https://www.optoutrealty.com": { body: `<title>Optout Realty</title>Optout Realty, Mesa — opt@optoutrealty.test` },
    });

    const result = await createLeadsFromCandidates("dataleadsell", [agent("Sam Sells Homes", null), agent("Optout Realty", null)], ctx);

    expect(result.created).toHaveLength(0);
    expect(result.skipped).toMatchObject({ addressInUse: 1, optedOut: 1 });
  });

  it("stops starting new lookups once the time budget is spent", async () => {
    stubFetch({});
    const result = await createLeadsFromCandidates("dataleadsell", [agent("A B", null), agent("C D", null)], {
      ...ctx,
      deadline: Date.now() - 1,
    });
    expect(result).toMatchObject({ examined: 0, stoppedEarly: true });
  });
});

describe("email lookup for an existing lead", () => {
  it("moves a New lead with no findable email to the call list (or contactless list)", async () => {
    stubFetch({});
    const withPhone = await makeAgentLead({ name: "No Site Agent", email: null, phone: "(480) 555-0100" });
    const withoutPhone = await makeAgentLead({ name: "Nobody Agent", email: null, phone: null });
    const pipeline = getPipeline("dataleadsell");

    expect(await findEmailForLead("dataleadsell", (await pipeline.findLead(prisma, withPhone.id))!)).toEqual({
      kind: "none",
      routedTo: "cold_call_list",
      unverified: null,
    });
    expect(await findEmailForLead("dataleadsell", (await pipeline.findLead(prisma, withoutPhone.id))!)).toEqual({
      kind: "none",
      routedTo: "contactless_list",
      unverified: null,
    });
    const after = await prisma.agentLead.findUniqueOrThrow({ where: { id: withPhone.id } });
    expect(after.emailCheckedAt).not.toBeNull();
  });

  it("flags a found address that another lead already uses, so it's never auto-sent", async () => {
    await makeAgentLead({ name: "First", email: "team@acmerealty.test" });
    const second = await makeAgentLead({ name: "Acme Realty", email: null, city: "Mesa" });
    stubFetch({ "https://www.acmerealty.com": { body: `<title>Acme Realty</title>Acme Realty of Mesa: team@acmerealty.test` } });

    const outcome = await findEmailForLead("dataleadsell", (await getPipeline("dataleadsell").findLead(prisma, second.id))!);

    expect(outcome).toMatchObject({ kind: "found", email: "team@acmerealty.test" });
    const after = await prisma.agentLead.findUniqueOrThrow({ where: { id: second.id } });
    expect(after.sendBlockedReason).toMatch(/^Duplicate address/);
  });
});

describe("lookups in a batch", () => {
  it("runs several at once, so a short budget still checks the whole batch, and saves each address once", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = new URL(input instanceof URL ? input.toString() : typeof input === "string" ? input : (input as Request).url);
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 100));
        inFlight--;
        if (url.pathname !== "/") return new Response("", { status: 404 });
        // biz0 and biz1 share one address: only the first saved keeps it.
        const host = url.hostname === "biz1.test" ? "biz0.test" : url.hostname;
        return new Response(`<html><body>Email us: hello@${host}</body></html>`, { headers: { "content-type": "text/html" } });
      }),
    );
    const candidates: DiscoveryCandidate[] = Array.from({ length: 16 }, (_, i) => ({
      name: `Business ${i}`,
      phone: null,
      address: null,
      website: `https://biz${i}.test`,
    }));

    const result = await createLeadsFromCandidates("cold-outreach", candidates, { ...ctx, maxCreate: 50, deadline: Date.now() + 10_000 });

    expect(result.examined).toBe(16);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(result.created).toHaveLength(15);
    expect(result.skipped.addressInUse).toBe(1);
    expect(new Set(result.created.map((l) => l.email)).size).toBe(15);
  });

  it("stops at maxCreate", async () => {
    stubFetch(Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`https://biz${i}.test`, page(`hello@biz${i}.test`)])));
    const candidates: DiscoveryCandidate[] = Array.from({ length: 6 }, (_, i) => ({
      name: `Shop ${i}`,
      phone: null,
      address: null,
      website: `https://biz${i}.test`,
    }));

    const result = await createLeadsFromCandidates("cold-outreach", candidates, { ...ctx, maxCreate: 2 });

    expect(result.created).toHaveLength(2);
  });
});
