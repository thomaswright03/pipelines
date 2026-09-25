// Every stored heuristic decision records which version of the rules made
// it, and the version changes when a rule does.
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { POST } from "@/app/api/email-inbound/route";
import { rulesVersion } from "@/lib/outreach/rules-version";
import { REPLY_RULES_VERSION } from "@/lib/outreach/reply-classifier";
import { INBOUND_RULES_VERSION } from "@/lib/outreach/inbound";
import { createLeadsFromCandidates, EMAIL_RULES_VERSION } from "@/lib/outreach/discovery";
import { page, stubFetch } from "./helpers";

describe("rulesVersion", () => {
  it("is stable for the same rules and changes when a pattern, a word list or the revision changes", () => {
    const base = rulesVersion("reply", 1, [/\bstop\b/i, new Set(["a", "b"])]);
    expect(rulesVersion("reply", 1, [/\bstop\b/i, new Set(["b", "a"])])).toBe(base);
    expect(base).toMatch(/^reply\.1-[0-9a-f]{8}$/);
    expect(rulesVersion("reply", 1, [/\bstop\b/, new Set(["a", "b"])])).not.toBe(base);
    expect(rulesVersion("reply", 1, [/\bstop\b/i, new Set(["a", "b", "c"])])).not.toBe(base);
    expect(rulesVersion("reply", 2, [/\bstop\b/i, new Set(["a", "b"])])).not.toBe(base);
  });
});

describe("stored decisions carry the rules version", () => {
  it("on every inbound reply", async () => {
    await POST(
      new NextRequest("http://localhost/api/email-inbound", {
        method: "POST",
        headers: { authorization: "Bearer test-inbound-secret", "content-type": "application/json" },
        body: JSON.stringify({ from: "someone@example.test", text: "Yes, interested" }),
      }),
    );
    const row = await prisma.inboundReply.findFirstOrThrow();
    expect(row.rulesVersion).toBe(INBOUND_RULES_VERSION);
    expect(row.rulesVersion).toContain(REPLY_RULES_VERSION);
  });

  it("on every address discovery accepts", async () => {
    stubFetch({ "https://www.kellerwilliams.com": page("Keller Williams Mesa: jane.doe@kellerwilliams.test") });
    await createLeadsFromCandidates("dataleadsell", [{ name: "Jane Doe", brokerage: "Keller Williams", phone: null, address: null, website: null }], {
      city: "Mesa",
      state: "AZ",
      county: "Maricopa",
      source: "test",
      maxCreate: 10,
      deadline: Number.POSITIVE_INFINITY,
    });
    const lead = await prisma.agentLead.findFirstOrThrow();
    expect(lead.emailRulesVersion).toBe(EMAIL_RULES_VERSION);
  });
});
