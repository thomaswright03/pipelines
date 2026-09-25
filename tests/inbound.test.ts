import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { POST } from "@/app/api/email-inbound/route";
import { removeSuppressionAction } from "@/lib/actions/outreach";
import { sendFirstTouch } from "@/lib/outreach/send";
import { captureMail, makeAgentLead, makeColdLead } from "./helpers";

function inbound(body: unknown, auth = "Bearer test-inbound-secret") {
  return POST(
    new NextRequest("http://localhost/api/email-inbound", {
      method: "POST",
      headers: { authorization: auth, "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

let mail: ReturnType<typeof captureMail> | undefined;
afterEach(() => mail?.restore());

describe("/api/email-inbound", () => {
  it("rejects a missing or wrong bearer token", async () => {
    expect((await inbound({ from: "x@example.test" }, "Bearer wrong")).status).toBe(401);
    expect((await inbound({ from: "x@example.test" }, "")).status).toBe(401);
  });

  it("rejects a malformed body with 400, not a crash", async () => {
    expect((await inbound("not json")).status).toBe(400);
    expect((await inbound({ subject: "no from" })).status).toBe(400);
  });

  it("records an interested reply as a reply — even with the quoted 'Reply STOP' footer", async () => {
    const cold = await makeColdLead({ email: "x@example.test", status: "contacted" });
    const agent = await makeAgentLead({ email: "x@example.test", status: "contacted" });

    const res = await inbound({
      from: "Pat Prospect <X@Example.test>",
      subject: "Re: I probably shouldn't have sent this",
      text: "Yes, interested!\n\nOn Thu … wrote:\n> Reply STOP and we won't email you again.",
    });
    const json = await res.json();

    expect(json.optedOut).toBe(false);
    expect(json.matched.sort()).toEqual([`cold-outreach:${cold.id}`, `dataleadsell:${agent.id}`].sort());
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: cold.id } })).status).toBe("responded");
    expect((await prisma.agentLead.findUniqueOrThrow({ where: { id: agent.id } })).status).toBe("responded");
    expect(await prisma.suppressedEmail.count()).toBe(0);
    const activity = await prisma.leadActivity.findFirstOrThrow({ where: { leadId: cold.id } });
    expect(activity.notes).toContain("Yes, interested!");
    expect(activity.notes).not.toContain("Reply STOP");
  });

  it("suppresses a genuine STOP, keeps the evidence, and blocks future sends", async () => {
    mail = captureMail();
    const lead = await makeColdLead({ email: "stop@example.test", status: "contacted" });
    const other = await makeAgentLead({ email: "stop@example.test" });

    const json = await (await inbound({ from: "stop@example.test", subject: "Re: hi", text: "STOP" })).json();

    expect(json).toMatchObject({ optedOut: true, trigger: "STOP" });
    expect(await prisma.suppressedEmail.findUniqueOrThrow({ where: { email: "stop@example.test" } })).toMatchObject({
      source: "inbound_reply",
      evidence: "STOP",
    });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("lost");
    expect(await sendFirstTouch("dataleadsell", other.id)).toMatchObject({ ok: false, reason: "blocked" });
    expect(mail.messages).toHaveLength(0);
  });

  it("lets the operator reverse a wrong opt-out from the lead", async () => {
    const lead = await makeColdLead({ email: "oops@example.test", status: "contacted" });
    await inbound({ from: "oops@example.test", text: "Please remove me" });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("lost");

    const result = await removeSuppressionAction("cold-outreach", lead.id);

    expect(result).toEqual({
      ok: true,
      message: `Removed oops@example.test from the do-not-email list — ${lead.name} is back to Responded.`,
    });
    const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after).toMatchObject({ status: "responded", sendBlockedReason: null });
    expect(await prisma.suppressedEmail.count()).toBe(0);
  });
});
