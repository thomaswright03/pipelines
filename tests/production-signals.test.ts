// Signals from real mail that show how the app is doing, apart from the
// labelled test sets: whether replies still reach the app (a warning on the
// dashboard and in the header after 48 hours of silence), and how the email
// finder's addresses fare, per pipeline and per version of its rules.
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { POST } from "@/app/api/email-inbound/route";
import { markBouncedAction } from "@/lib/actions/outreach";
import { getFinderQuality } from "@/lib/outreach/finder-quality";
import { editLead } from "@/lib/outreach/lead-edit";
import { getReplyHealth, SILENT_SENDS_THRESHOLD, warningReason } from "@/lib/outreach/reply-health";
import { sendFirstTouch } from "@/lib/outreach/send";
import { captureMail, makeColdLead } from "./helpers";

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

function inbound(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/email-inbound", {
      method: "POST",
      headers: { authorization: "Bearer test-inbound-secret", "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function sends(count: number, at: Date) {
  await prisma.outreachRecipient.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      pipeline: "cold-outreach",
      email: `s${i}-${at.getTime()}@x.test`,
      state: "sent",
      sentAt: at,
    })),
  });
}

let mail: ReturnType<typeof captureMail> | undefined;
afterEach(() => mail?.restore());

describe("replies not arriving", () => {
  it("doesn't warn in the first 48 hours after a send", async () => {
    await sends(5, daysAgo(1));
    expect(await getReplyHealth()).toMatchObject({ warning: false, reason: null });
  });

  it("warns once a send is 48 hours old and nothing has ever come back, and one inbound message clears it", async () => {
    await sends(1, daysAgo(3));
    expect(await getReplyHealth()).toMatchObject({ warning: true, reason: "never" });
    await inbound({ from: "anyone@x.test", subject: "Re: hi", text: "Out of office until Monday." });
    expect(await getReplyHealth()).toMatchObject({ warning: false, reason: null });
  });

  it("warns when the last message is over a week old", async () => {
    await inbound({ from: "old@x.test", subject: "Re: hi", text: "Sounds good" });
    await prisma.inboundReply.updateMany({ data: { receivedAt: daysAgo(8) } });
    await sends(1, daysAgo(3));
    expect(await getReplyHealth()).toMatchObject({ warning: true, reason: "silent_week" });
  });

  it(`warns when ${SILENT_SENDS_THRESHOLD} sends older than 48 hours went out after the last message`, async () => {
    await inbound({ from: "old@x.test", subject: "Re: hi", text: "Sounds good" });
    await prisma.inboundReply.updateMany({ data: { receivedAt: daysAgo(5) } });
    await sends(SILENT_SENDS_THRESHOLD - 1, daysAgo(3));
    expect(await getReplyHealth()).toMatchObject({ warning: false, sendsSinceLastReply: SILENT_SENDS_THRESHOLD - 1 });
    await sends(1, daysAgo(3));
    expect(await getReplyHealth()).toMatchObject({ warning: true, reason: "silent_sends", sendsSinceLastReply: SILENT_SENDS_THRESHOLD });
  });

  it("gives the reason in order: never, then a silent week, then silent sends", () => {
    const now = new Date();
    expect(warningReason(0, null, now)).toBeNull();
    expect(warningReason(1, null, now)).toBe("never");
    expect(warningReason(1, new Date(now.getTime() - 8 * DAY), now, 50)).toBe("silent_week");
    expect(warningReason(1, new Date(now.getTime() - 3 * DAY), now, SILENT_SENDS_THRESHOLD)).toBe("silent_sends");
    expect(warningReason(1, new Date(now.getTime() - 3 * DAY), now, 2)).toBeNull();
  });
});

describe("how found addresses are doing, per rules version", () => {
  it("counts sends, bounces, wrong-person replies and hand corrections by where the address came from", async () => {
    mail = captureMail();
    const found = (version: string) => ({ emailEvidence: "Found on the business's website (contact page)", emailRulesVersion: version });
    const a = await makeColdLead({ email: "a@one.test", ...found("email.3-aaaa") });
    const b = await makeColdLead({ email: "b@two.test", ...found("email.3-aaaa") });
    const c = await makeColdLead({ email: "c@three.test", ...found("email.4-bbbb") });
    const hand = await makeColdLead({ email: "typed@four.test", emailEvidence: "Entered by hand on Sep 1, 2026" });
    for (const lead of [a, b, c, hand]) expect(await sendFirstTouch("cold-outreach", lead.id)).toMatchObject({ ok: true });

    expect(await markBouncedAction("cold-outreach", a.id)).toMatchObject({ ok: true });
    await inbound({ from: "b@two.test", subject: "Re: hi", text: "You have the wrong person." });
    // A found address replaced before it was pitched: the lookup picked the wrong one.
    const d = await makeColdLead({ email: "wrong@five.test", ...found("email.4-bbbb") });
    expect(await editLead("cold-outreach", d.id, "right@five.test", {})).toMatchObject({ ok: true });

    const quality = await getFinderQuality();
    expect(quality.sinceDays).toBe(90);
    const cold = quality.pipelines.find((p) => p.pipeline === "cold-outreach")!;
    const strip = cold.rows.map(({ firstSent, ...rest }) => {
      expect(firstSent === null || firstSent instanceof Date).toBe(true);
      return rest;
    });
    expect(strip).toEqual(
      expect.arrayContaining([
        { source: "found", rulesVersion: "email.3-aaaa", leadsEmailed: 2, sends: 2, bounced: 1, wrongPerson: 1, corrected: 0 },
        { source: "found", rulesVersion: "email.4-bbbb", leadsEmailed: 1, sends: 1, bounced: 0, wrongPerson: 0, corrected: 1 },
        { source: "hand", rulesVersion: null, leadsEmailed: 1, sends: 1, bounced: 0, wrongPerson: 0, corrected: 0 },
      ]),
    );
    expect(strip).toHaveLength(3);
    expect(quality.pipelines.find((p) => p.pipeline === "dataleadsell")!.rows).toEqual([]);

    const correction = await prisma.outreachCorrection.findFirstOrThrow({ where: { kind: "address_corrected" } });
    expect(correction).toMatchObject({ email: "wrong@five.test", rulesVersion: "email.4-bbbb", leadId: d.id });
  });

  it("doesn't count replacing an address the operator typed in", async () => {
    const lead = await makeColdLead({ email: "typo@six.test", emailEvidence: "Entered by hand on Sep 1, 2026" });
    expect(await editLead("cold-outreach", lead.id, "fixed@six.test", {})).toMatchObject({ ok: true });
    expect(await prisma.outreachCorrection.count()).toBe(0);
  });
});
