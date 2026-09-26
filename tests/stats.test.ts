import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getVaultStats } from "@/lib/pipeline-stats";
import { sendFirstTouch } from "@/lib/outreach/send";
import { COLD_OUTREACH_TEMPLATE_VERSION } from "@/lib/vault-email-template";
import { DATALEADSELL_TEMPLATE_VERSION } from "@/lib/dataleadsell-email-template";
import { templateVersion } from "@/lib/email-template-version";
import { captureMail, makeColdLead } from "./helpers";

describe("Stats page numbers", () => {
  it("reply rate is replied leads ÷ distinct leads emailed, not ÷ sends", async () => {
    const leads = await Promise.all(Array.from({ length: 10 }, (_, i) => makeColdLead({ email: `r${i}@x.test` })));
    for (const lead of leads) await prisma.leadEmailSendLog.create({ data: { leadId: lead.id, email: lead.email! } });
    for (const lead of leads.slice(0, 2)) await prisma.leadEmailSendLog.create({ data: { leadId: lead.id, email: lead.email! } });
    for (const lead of leads.slice(0, 3)) {
      await prisma.lead.update({ where: { id: lead.id }, data: { repliedAt: new Date(), status: "responded" } });
    }
    // A lead that "replied" without ever being emailed (e.g. a cold-call yes) doesn't count.
    await makeColdLead({ repliedAt: new Date(), status: "responded" });

    const s = await getVaultStats();
    expect(s).toMatchObject({ emailsSentTotal: 12, leadsEmailed: 10, replied: 3, replyRate: 0.3 });
  });

  it("counts a 6 PM Arizona send toward that Arizona day", async () => {
    const lead = await makeColdLead();
    // 6:00 PM MST on Sep 24 is 01:00 UTC on Sep 25.
    await prisma.leadEmailSendLog.create({ data: { leadId: lead.id, email: lead.email!, sentAt: new Date("2026-09-25T01:00:00Z") } });
    // "Now" is 9 PM MST the same evening.
    const s = await getVaultStats(new Date("2026-09-25T04:00:00Z"));
    expect(s.emailsSentToday).toBe(1);
    expect(s.emailsPerDay.at(-1)).toEqual({ day: "2026-09-24", count: 1 });

    // The next Arizona morning it's yesterday's.
    const next = await getVaultStats(new Date("2026-09-25T15:00:00Z"));
    expect(next.emailsSentToday).toBe(0);
    expect(next.emailsPerDay.at(-2)).toEqual({ day: "2026-09-24", count: 1 });
  });
});

describe("which version of the pitch each send used", () => {
  it("is stored with the send, and the Stats page compares reply rates across versions", async () => {
    const mail = captureMail();
    try {
      const lead = await makeColdLead({ company: "Bob's Bakery" });
      expect(await sendFirstTouch("cold-outreach", lead.id)).toMatchObject({ ok: true });
      const log = await prisma.leadEmailSendLog.findFirstOrThrow({ where: { leadId: lead.id } });
      expect(log).toMatchObject({ subject: mail.messages[0]!.subject, templateVersion: COLD_OUTREACH_TEMPLATE_VERSION });
      expect(COLD_OUTREACH_TEMPLATE_VERSION).toMatch(/^cold-outreach-[0-9a-f]{8}$/);

      // An older send, from before versions were recorded, that got a reply.
      const old = await makeColdLead({ status: "responded", repliedAt: new Date() });
      await prisma.leadEmailSendLog.create({ data: { leadId: old.id, email: old.email!, sentAt: new Date("2026-01-01T00:00:00Z") } });

      const { byTemplate } = await getVaultStats();
      expect(byTemplate).toEqual([
        { version: COLD_OUTREACH_TEMPLATE_VERSION, subject: log.subject, sent: 1, leads: 1, replied: 0, replyRate: 0 },
        { version: null, subject: null, sent: 1, leads: 1, replied: 1, replyRate: 1 },
      ]);
    } finally {
      mail.restore();
    }
  });

  it("changes whenever the wording does, and not otherwise", () => {
    const pitch = { subject: "Hello", body: "Body" };
    expect(templateVersion("x", [pitch])).toBe(templateVersion("x", [{ ...pitch }]));
    expect(templateVersion("x", [pitch])).not.toBe(templateVersion("x", [{ ...pitch, subject: "Hello!" }]));
    expect(templateVersion("x", [pitch])).not.toBe(templateVersion("x", [{ ...pitch, body: "Body." }]));
    expect(DATALEADSELL_TEMPLATE_VERSION).toMatch(/^dataleadsell-[0-9a-f]{8}$/);
  });
});
