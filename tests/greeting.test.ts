// dataleadsell's pitch greets the agent by first name, however the listing
// names them — and the lead page preview is exactly what gets sent.
import { afterEach, describe, expect, it } from "vitest";
import { greetingName, buildAgentOutreachEmail } from "@/lib/dataleadsell-email-template";
import { getPipeline } from "@/lib/outreach/pipelines";
import { sendFirstTouch } from "@/lib/outreach/send";
import { prisma } from "@/lib/db";
import { captureMail, makeAgentLead } from "./helpers";

let mail: ReturnType<typeof captureMail> | undefined;
afterEach(() => mail?.restore());

describe("greetingName", () => {
  const cases: [string, string | null][] = [
    ["JANE M DOE - Keller Williams Realty", "Jane"],
    ["Jane Doe", "Jane"],
    ["jane doe | HomeSmart", "Jane"],
    ["Doe, Jane Marie", "Jane"],
    ["Dr. Pat O'NEIL", "Pat"],
    ["J. Michael Smith", "Michael"],
    ["MARY-KATE OLSEN", "Mary-Kate"],
    ["The Smith Team", null],
    ["Desert Realty Group", null],
    ["J. R.", null],
    ["", null],
  ];
  for (const [raw, expected] of cases) {
    it(`${JSON.stringify(raw)} → ${expected ?? "there"}`, () => {
      expect(greetingName(raw)).toBe(expected);
    });
  }

  it("falls back to 'Hey there'", () => {
    expect(buildAgentOutreachEmail("Desert Realty Group", "Maricopa").body.startsWith("Hey there,\n")).toBe(true);
  });
});

describe("the sent greeting matches the preview", () => {
  it("sends 'Hey Jane,' for a roster-style name", async () => {
    mail = captureMail();
    const lead = await makeAgentLead({ name: "JANE M DOE - Keller Williams Realty", email: "jane@kw.test" });
    const preview = getPipeline("dataleadsell").buildEmail({ name: lead.name, company: null, county: lead.county });
    expect(preview.body.startsWith("Hey Jane,\n")).toBe(true);

    await sendFirstTouch("dataleadsell", lead.id);
    expect(mail.messages[0]!.text).toBe(preview.body);
    expect(await prisma.emailSendLog.count()).toBe(1);
  });
});

describe("the CAN-SPAM footer", () => {
  it("both pipelines' pitches carry the one postal address and an opt-out line", async () => {
    const { OUTREACH_MAILING_ADDRESS } = await import("@/lib/outreach-mailing-address");
    const { buildOutreachEmail } = await import("@/lib/vault-email-template");
    expect(buildOutreachEmail("Bob's Bakery").body).toContain(OUTREACH_MAILING_ADDRESS);
    expect(buildOutreachEmail("Bob's Bakery").body).toMatch(/Reply STOP/i);
    const agent = buildAgentOutreachEmail("Jane Doe", "Maricopa").body;
    expect(agent).toContain(OUTREACH_MAILING_ADDRESS);
    expect(agent.endsWith("Not interested? Just reply “unsubscribe” and I’ll take you off.")).toBe(true);
  });
});

describe("the dataleadsell pitch", () => {
  it("names the lead's county in the subject and the open-county line", () => {
    const { subject, body } = buildAgentOutreachEmail("Jane Doe", "Salt Lake");
    expect(subject).toBe("quick question about Salt Lake County");
    expect(body).toContain("I’m an agent in Salt Lake County too.");
    expect(body).toContain("Salt Lake County is still open.");
  });

  it("reads naturally without a county", () => {
    const { subject, body } = buildAgentOutreachEmail("Jane Doe", null);
    expect(subject).toBe("quick question about your county");
    expect(body).toContain("Your county is still open.");
  });

  it("leaves no template brackets in the email", () => {
    const { subject, body } = buildAgentOutreachEmail("Jane Doe", "Maricopa");
    expect(subject + body).not.toMatch(/[[\]]/);
  });
});
