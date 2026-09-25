import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getVaultStats } from "@/lib/pipeline-stats";
import { makeColdLead } from "./helpers";

describe("Data Central numbers", () => {
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
