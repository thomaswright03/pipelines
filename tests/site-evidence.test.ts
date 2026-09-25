// A guessed website is only trusted when it shows something we already know
// about the lead (phone, street address, city) — otherwise an unrelated
// business or person with a similar name would get the lead's one pitch.
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  createLeadsFromCandidates,
  describeDiscovery,
  findEmailForLead,
  isSameLead,
  type DiscoveryCandidate,
} from "@/lib/outreach/discovery";
import { getPipeline } from "@/lib/outreach/pipelines";
import { previewBulkSend } from "@/lib/outreach/send";
import { siteEvidence } from "@/lib/outreach/site-evidence";
import { makeColdLead, page, stubFetch } from "./helpers";

const ctx = { city: "Phoenix", state: "AZ", source: "Yelp search", maxCreate: 10, deadline: Number.POSITIVE_INFINITY };
const joes: DiscoveryCandidate = {
  name: "Joe's Pizza",
  phone: "+14805550199",
  address: "1234 N Central Ave, Phoenix, AZ 85004",
  website: null,
};

describe("siteEvidence", () => {
  const facts = { phone: "(480) 555-0199", address: "1234 N Central Ave, Phoenix, AZ 85004", city: "Phoenix" };

  it("accepts the lead's phone in any common format, including a tel: link", () => {
    for (const shown of ["(480) 555-0199", "480.555.0199", "+1 480 555 0199", '<a href="tel:+14805550199">Call</a>']) {
      expect(siteEvidence("https://www.x.com", [`<p>${shown}</p>`], facts)).toMatch(/phone number \(480\) 555-0199/);
    }
  });

  it("accepts the street address", () => {
    expect(siteEvidence("https://www.x.com", ["Visit us at 1234 North Central Avenue"], facts)).toMatch(/street address/);
  });

  it("doesn't accept the city alone — a chain or a same-named business in a big city passes that", () => {
    const joes = { ...facts, name: "Joe's Pizza", phone: "(480) 555-0199" };
    expect(siteEvidence("https://www.joespizza.com", ["<p>Joe's Pizza — proudly serving Phoenix since 1990</p>"], joes)).toBeNull();
    expect(siteEvidence("https://www.x.com", ["Proudly serving Phoenix since 1990"], facts)).toBeNull();
  });

  it("accepts the city with the lead's name in the page title, unless the site lists other locations", () => {
    const joes = { ...facts, name: "Joe's Pizza", phone: null, address: null };
    const titled = "<html><head><title>Joe&#39;s Pizza | Phoenix, AZ</title></head><body>Proudly serving Phoenix</body></html>";
    expect(siteEvidence("https://www.joespizza.com", [titled], joes)).toMatch(
      /titled with the lead's name and mentions the lead's city \(Phoenix\)/,
    );
    expect(siteEvidence("https://www.joespizza.com", [titled.replace("Proudly", "Find a location near you · Proudly")], joes)).toBeNull();
    // "Pizza" alone says what the business is, not which one.
    expect(
      siteEvidence("https://www.pizza.com", ["<title>Pizza Phoenix</title>Phoenix"], { ...joes, name: "Pizza Restaurant" }),
    ).toBeNull();
    // The title has to name this lead, not just any business.
    expect(siteEvidence("https://www.joespizza.com", ["<title>Tony's Pizza</title>Phoenix"], joes)).toBeNull();
  });

  it("rejects a site that shows none of them, or a different number", () => {
    expect(siteEvidence("https://www.x.com", ["Best pizza in Tempe! (602) 555-1234 · 99 Mill Ave"], facts)).toBeNull();
    // Not fooled by the number embedded in a longer one.
    expect(siteEvidence("https://www.x.com", ["Order #148055501990"], { ...facts, address: null, city: null })).toBeNull();
  });
});

describe("discovery only saves addresses from sites that are the lead's", () => {
  it("discards an address from a same-name site in another city with another phone", async () => {
    stubFetch({
      "https://www.joespizza.com": page(`Joe's Pizza — best pizza in Tempe! Call (602) 555-1234. orders@joespizza.test`),
    });

    const result = await createLeadsFromCandidates("cold-outreach", [joes], ctx);

    expect(result.created).toHaveLength(0);
    expect(result.skipped.unverifiedSite).toBe(1);
    expect(await prisma.lead.count()).toBe(0);
  });

  it("discards an address from a same-name site that only mentions the lead's city", async () => {
    stubFetch({
      "https://www.joespizza.com": page(`Joe's Pizza — the best slice in Phoenix! Call (602) 555-1234. orders@joespizza.test`),
    });

    const result = await createLeadsFromCandidates("cold-outreach", [joes], ctx);

    expect(result.created).toHaveLength(0);
    expect(result.skipped.unverifiedSite).toBe(1);
    expect(describeDiscovery("cold-outreach", "Phoenix, AZ", 1, result)).toMatch(/1 whose guessed website couldn't be confirmed as theirs/);
  });

  it("saves the address when the site shows the Yelp phone number, and records why", async () => {
    stubFetch({
      "https://www.joespizza.com": page(`Joe's Pizza · pizza by the slice · (480) 555-0199 · orders@joespizza.test`),
    });

    const result = await createLeadsFromCandidates("cold-outreach", [joes], ctx);

    expect(result.created.map((c) => c.email)).toEqual(["orders@joespizza.test"]);
    const lead = await prisma.lead.findFirstOrThrow();
    expect(lead.emailEvidence).toBe("Found on www.joespizza.com, which shows the lead's phone number (480) 555-0199.");
  });

  it("'Find email' on an existing lead reports an uncorroborated find without saving it, and it is never sent", async () => {
    const lead = await makeColdLead({ name: "Joe's Pizza", email: null, phone: "(480) 555-0199", city: "Phoenix" });
    stubFetch({ "https://www.joespizza.com": page(`Joe's Pizza, Tempe — (602) 555-1234 — orders@joespizza.test`) });

    const outcome = await findEmailForLead("cold-outreach", (await getPipeline("cold-outreach").findLead(prisma, lead.id))!);

    expect(outcome).toMatchObject({
      kind: "none",
      unverified: { website: "https://www.joespizza.com", email: "orders@joespizza.test" },
    });
    const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after).toMatchObject({ email: null, website: null });
    expect((await previewBulkSend("cold-outreach")).willSend).toBe(0);
  });

  it("trusts a website entered on the lead without further checks", async () => {
    const lead = await makeColdLead({ name: "Joe's Pizza", email: null, website: "https://joes.example.test" });
    stubFetch({ "https://joes.example.test": page(`orders@joes.test`) });
    const outcome = await findEmailForLead("cold-outreach", (await getPipeline("cold-outreach").findLead(prisma, lead.id))!);
    expect(outcome).toMatchObject({
      kind: "found",
      email: "orders@joes.test",
      evidence: "Found on joes.example.test, the website saved on this lead.",
    });
  });
});

describe("duplicate detection uses more than the name", () => {
  const smith = (phone: string, city: string): DiscoveryCandidate => ({ name: "John Smith", phone, address: null, city, website: null });

  it("keeps two different John Smiths, and never duplicates the same one", async () => {
    stubFetch({
      "https://www.johnsmith.com": page(`John Smith Realty — Mesa and Phoenix — (480) 555-0001, (602) 555-0002 — john@johnsmith.test`),
    });
    expect(
      isSameLead(
        { name: "John Smith", phone: "(480) 555-0001", address: null, city: "Mesa" },
        { name: "john  smith", phone: "+14805550001", address: null, city: "Phoenix" },
      ),
    ).toBe(true);
    expect(
      isSameLead(
        { name: "John Smith", phone: "(480) 555-0001", address: null, city: "Mesa" },
        { name: "John Smith", phone: "(602) 555-0002", address: null, city: "Mesa" },
      ),
    ).toBe(false);
    expect(
      isSameLead(
        { name: "John Smith", phone: null, address: null, city: "Mesa" },
        { name: "John Smith", phone: null, address: null, city: "Phoenix" },
      ),
    ).toBe(false);
    expect(
      isSameLead(
        { name: "John Smith", phone: null, address: null, city: null },
        { name: "John Smith", phone: null, address: null, city: "Mesa" },
      ),
    ).toBe(true);

    await prisma.agentLead.create({ data: { name: "John Smith", email: "js@other.test", phone: "(602) 555-0002", city: "Phoenix" } });
    const again = await createLeadsFromCandidates("dataleadsell", [smith("+16025550002", "Phoenix")], { ...ctx, county: "Maricopa" });
    expect(again.skipped.existingName).toBe(1);

    const other = await createLeadsFromCandidates("dataleadsell", [smith("+14805550001", "Mesa")], { ...ctx, county: "Maricopa" });
    expect(other.skipped.existingName).toBe(0);
    expect(other.created.map((c) => c.email)).toEqual(["john@johnsmith.test"]);
    expect(await prisma.agentLead.count({ where: { name: "John Smith" } })).toBe(2);
  });

  it("the same candidate twice in one run creates one lead", async () => {
    stubFetch({ "https://www.johnsmith.com": page(`John Smith — (480) 555-0001 — john@johnsmith.test`) });
    const result = await createLeadsFromCandidates("dataleadsell", [smith("+14805550001", "Mesa"), smith("+14805550001", "Mesa")], {
      ...ctx,
      county: "Maricopa",
    });
    expect(result.created).toHaveLength(1);
    expect(result.skipped.existingName).toBe(1);
  });
});
