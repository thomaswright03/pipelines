// The cold-call deck's "Add to Contacts" link: a vCard for the lead, served
// inline, and plain refusals for a lead that can't have one.
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/contact-card/[pipeline]/[leadId]/route";
import { makeAgentLead, makeColdLead } from "./helpers";

function card(pipeline: string, leadId: string) {
  return GET(new NextRequest(`http://localhost/api/contact-card/${pipeline}/${leadId}`), {
    params: Promise.resolve({ pipeline, leadId }),
  });
}

describe("/api/contact-card", () => {
  it("serves a Cold Outreach lead's vCard inline, with the name escaped", async () => {
    const lead = await makeColdLead({ name: "Smith, Jones; Partners", phone: "(480) 555-0100" });
    const res = await card("cold-outreach", lead.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/vcard; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe('inline; filename="Smith Jones Partners.vcf"');
    expect(await res.text()).toBe(
      [
        "BEGIN:VCARD",
        "VERSION:3.0",
        "N:Smith\\, Jones\\; Partners;;;;",
        "FN:Smith\\, Jones\\; Partners",
        "TEL;TYPE=WORK:(480) 555-0100",
        "END:VCARD",
        "",
      ].join("\r\n"),
    );
  });

  it("serves a dataleadsell agent's vCard, with a safe file name for any name", async () => {
    const agent = await makeAgentLead({ name: "🏠🏠", phone: "801-555-0101" });
    const res = await card("dataleadsell", agent.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('inline; filename="contact.vcf"');
    expect(await res.text()).toContain("TEL;TYPE=WORK:801-555-0101");
  });

  it("says why when the lead has no phone number", async () => {
    const lead = await makeColdLead({ phone: null });
    const res = await card("cold-outreach", lead.id);
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("This lead has no phone number on file");
  });

  it("is a 404 for an unknown pipeline or lead", async () => {
    const lead = await makeColdLead({ phone: "(480) 555-0100" });
    expect((await card("nope", lead.id)).status).toBe(404);
    expect((await card("dataleadsell", lead.id)).status).toBe(404); // a Cold Outreach id in the other pipeline
    expect((await card("cold-outreach", "missing")).status).toBe(404);
  });
});
