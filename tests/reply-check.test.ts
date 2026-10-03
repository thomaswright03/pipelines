// The reply-loop check in Settings → Connections: the real pitch goes to
// an address the owner controls, their reply comes back through the
// inbound route, and the check reports what was recorded.
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { POST } from "@/app/api/email-inbound/route";
import { startReplyCheckAction } from "@/lib/actions/settings";
import { listReplyChecks, REPLY_CHECK_PATIENCE_MS, REPLY_CHECK_SOURCE } from "@/lib/outreach/reply-check";
import { setOutboundPaused } from "@/lib/outreach/settings";
import { getSuppression } from "@/lib/email-suppression";
import { captureMail } from "./helpers";

function reply(from: string, text: string) {
  return POST(
    new NextRequest("http://localhost/api/email-inbound", {
      method: "POST",
      headers: { authorization: "Bearer test-inbound-secret", "content-type": "application/json" },
      body: JSON.stringify({ from, subject: "Re: Quick question", text }),
    }),
  );
}

let mail: ReturnType<typeof captureMail> | undefined;
afterEach(() => {
  mail?.restore();
  mail = undefined;
});

describe("the reply-loop check", () => {
  it("sends the real pitch, then reports an interested reply recorded on the lead", async () => {
    mail = captureMail();
    const result = await startReplyCheckAction("Owner+Check1@Example.test");
    expect(result).toMatchObject({
      ok: true,
      message: expect.stringContaining("Sent the Cold Outreach pitch to owner+check1@example.test"),
    });
    expect(mail.to()).toEqual(["owner+check1@example.test"]);
    expect(await prisma.lead.findFirstOrThrow({ where: { source: REPLY_CHECK_SOURCE } })).toMatchObject({ status: "contacted" });

    const [waiting] = await listReplyChecks();
    expect(waiting).toMatchObject({ state: "waiting", email: "owner+check1@example.test", reply: null });
    const later = new Date(Date.now() + REPLY_CHECK_PATIENCE_MS + 60_000);
    expect((await listReplyChecks(3, later))[0]).toMatchObject({ state: "late" });

    await reply("Owner <owner+check1@example.test>", "Yes, interested — what does it cost?");
    const [recorded] = await listReplyChecks();
    expect(recorded).toMatchObject({
      state: "recorded",
      status: "responded",
      reply: { verdict: "positive", kind: "reply", optedOut: false },
    });
  });

  it("reports a STOP reply as an opt-out: the lead is closed and the address suppressed", async () => {
    mail = captureMail();
    await startReplyCheckAction("owner+stop@example.test");
    await reply("owner+stop@example.test", "STOP");
    const [check] = await listReplyChecks();
    expect(check).toMatchObject({ state: "recorded", status: "lost", reply: { verdict: "opt_out", optedOut: true } });
    expect(await getSuppression("owner+stop@example.test")).not.toBeNull();
  });

  it("refuses an address that was already pitched, suggesting a plus-address, and sends nothing", async () => {
    mail = captureMail();
    await startReplyCheckAction("owner@example.test");
    const again = await startReplyCheckAction("owner@example.test");
    expect(again).toMatchObject({ ok: false, error: expect.stringMatching(/each address gets one pitch.*owner\+check\d+@example\.test/) });
    expect(mail.messages).toHaveLength(1);
    expect(await prisma.lead.count({ where: { source: REPLY_CHECK_SOURCE } })).toBe(1);
  });

  it("refuses while sending is paused or the address is unusable, creating no lead", async () => {
    mail = captureMail();
    expect(await startReplyCheckAction("not an address")).toMatchObject({ ok: false, error: expect.stringMatching(/full email address/) });
    await setOutboundPaused(true);
    expect(await startReplyCheckAction("owner@example.test")).toMatchObject({ ok: false, error: expect.stringMatching(/paused/) });
    expect(mail.messages).toHaveLength(0);
    expect(await prisma.lead.count()).toBe(0);
  });

  it("says so when the pitch couldn't be sent", async () => {
    mail = captureMail();
    mail.refuse("owner+bad@example.test");
    const result = await startReplyCheckAction("owner+bad@example.test");
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/^The test pitch wasn't sent: /) });
    expect((await listReplyChecks())[0]).toMatchObject({ state: "not_sent" });
  });
});
