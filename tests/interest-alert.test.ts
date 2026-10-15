import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { POST } from "@/app/api/email-inbound/route";
import { HITTA_URL } from "@/lib/hitta";
import { alertInterest, buildInterestReport } from "@/lib/outreach/interest-alert";
import { makeColdLead, makeHaulerLead } from "./helpers";

function inbound(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/email-inbound", {
      method: "POST",
      headers: { authorization: "Bearer test-inbound-secret", "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

/** Stands in for Hitta: answers every report with `status` and remembers what it was sent. */
function stubHitta(status = 201) {
  const sent: { url: string; auth: string | null; body: Record<string, string> }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      sent.push({ url, auth: new Headers(init.headers).get("authorization"), body: JSON.parse(String(init.body)) });
      return new Response(status === 201 ? '{"ok":true}' : "nope", { status });
    }),
  );
  return sent;
}

describe("interest alerts", () => {
  it("calls Thomas through Hitta, urgently, when a lead replies with interest", async () => {
    vi.stubEnv("HITTA_API_KEY", " cso-key \n");
    const sent = stubHitta();
    await makeHaulerLead({
      name: "Dana",
      company: "Rocky Haul",
      city: "Mesa",
      state: "AZ",
      phone: "(480) 555-0199",
      email: "dana@rockyhaul.test",
      status: "contacted",
    });

    const res = await inbound({ from: "Dana <dana@rockyhaul.test>", text: "Yes, I'm interested. Can you call me tomorrow?" });

    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe(HITTA_URL);
    expect(sent[0]!.auth).toBe("Bearer cso-key");
    expect(sent[0]!.body).toMatchObject({
      project: "Chief Sales Officer",
      urgency: "urgent",
      title: "Dana at Rocky Haul is interested in Garbage AI, the AI that texts back haulers' leads",
    });
    expect(sent[0]!.body.summary).toContain("Dana at Rocky Haul in Mesa, AZ replied to the pitch with interest.");
    expect(sent[0]!.body.summary).toContain("They wrote: Yes, I'm interested. Can you call me tomorrow?");
    expect(sent[0]!.body.summary).toContain("4 8 0 5 5 5 0 1 9 9");
    expect(sent[0]!.body.summary).not.toMatch(/https?:|\*|#/);
    const stored = await prisma.inboundReply.findFirstOrThrow();
    expect(stored.interestAlertedAt).not.toBeNull();
    expect(stored.interestAlertError).toBeNull();
    expect(JSON.parse(stored.interestReport!)).toEqual(sent[0]!.body);
  });

  it("sends nothing for a no, an opt-out, a thank-you or a reply that needs a look", async () => {
    vi.stubEnv("HITTA_API_KEY", "cso-key");
    const sent = stubHitta();
    for (const text of ["Not interested, thanks.", "Please remove me from your list.", "Thanks!", "Maybe, not sure."]) {
      const lead = await makeColdLead({ status: "contacted" });
      await inbound({ from: lead.email, text });
    }
    expect(sent).toHaveLength(0);
    expect(await prisma.inboundReply.count({ where: { interestReport: { not: null } } })).toBe(0);
  });

  it("alerts once, even when the Worker delivers the same reply twice", async () => {
    vi.stubEnv("HITTA_API_KEY", "cso-key");
    const sent = stubHitta();
    const lead = await makeColdLead({ status: "contacted" });
    const reply = { from: lead.email, text: "Sounds great, what would it cost?", messageId: "<one@example.test>" };
    await inbound(reply);
    await inbound(reply);
    expect(sent).toHaveLength(1);
  });

  it("keeps the report for the CSO to resend when Hitta can't take it, and still records the reply", async () => {
    vi.stubEnv("HITTA_API_KEY", "wrong-key");
    stubHitta(401);
    const lead = await makeColdLead({ status: "contacted" });

    const res = await inbound({ from: lead.email, text: "Yes please, tell me more." });

    expect(res.status).toBe(200);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("responded");
    const stored = await prisma.inboundReply.findFirstOrThrow();
    expect(stored.interestAlertedAt).toBeNull();
    expect(stored.interestAlertError).toBe("Hitta refused the key (401): HITTA_API_KEY is wrong.");
    expect(stored.interestReport).toContain('"urgency":"urgent"');

    // A later resend uses the stored report and records the success.
    vi.stubEnv("HITTA_API_KEY", "cso-key");
    const sent = stubHitta();
    expect(await alertInterest(stored.id)).toMatchObject({ ok: true });
    expect(sent[0]!.body).toEqual(JSON.parse(stored.interestReport!));
    expect((await prisma.inboundReply.findUniqueOrThrow({ where: { id: stored.id } })).interestAlertedAt).not.toBeNull();
    // ...and never twice.
    expect(await alertInterest(stored.id)).toBeNull();
  });

  it("records that the key is missing instead of failing the reply", async () => {
    vi.stubEnv("HITTA_API_KEY", "");
    const lead = await makeColdLead({ status: "contacted" });
    expect((await inbound({ from: lead.email, text: "Interested! Call me." })).status).toBe(200);
    expect((await prisma.inboundReply.findFirstOrThrow()).interestAlertError).toBe("HITTA_API_KEY isn't set.");
  });

  it("still alerts for an interested reply from an address no lead has", async () => {
    vi.stubEnv("HITTA_API_KEY", "cso-key");
    const sent = stubHitta();
    await inbound({ from: "boss@newco.test", text: "Yes, I'm interested. Call me." });
    expect(sent[0]!.body.title).toBe("Someone replied with interest from boss@newco.test");
    expect(sent[0]!.body.summary).toContain("Unmatched replies");
  });

  it("says when there's no phone number, and names every product the address was pitched", () => {
    const lead = { id: "1", name: "Sam", company: null, city: null, state: null, phone: null } as never;
    const report = buildInterestReport({ fromEmail: "sam@x.test", subject: null, text: "Interested" }, [
      { pipeline: "cold-outreach", lead },
      { pipeline: "dataleadsell", lead },
    ]);
    expect(report.title).toBe("Sam is interested in custom software from Wright AI Solutions");
    expect(report.summary).toContain("custom software from Wright AI Solutions and the Probate Property Leads subscription");
    expect(report.summary).toContain("There's no phone number on file; their email is sam@x.test.");
  });
});
