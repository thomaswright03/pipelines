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

  it("falls back to 'Hi there'", () => {
    expect(buildAgentOutreachEmail("Desert Realty Group", "Maricopa").body.startsWith("Hi there,\n")).toBe(true);
  });
});

describe("the sent greeting matches the preview", () => {
  it("sends 'Hi Jane,' for a roster-style name", async () => {
    mail = captureMail();
    const lead = await makeAgentLead({ name: "JANE M DOE - Keller Williams Realty", email: "jane@kw.test" });
    const preview = getPipeline("dataleadsell").buildEmail({ name: lead.name, company: null, county: lead.county });
    expect(preview.body.startsWith("Hi Jane,\n")).toBe(true);

    await sendFirstTouch("dataleadsell", lead.id);
    expect(mail.messages[0]!.text).toBe(preview.body);
    expect(await prisma.emailSendLog.count()).toBe(1);
  });
});
