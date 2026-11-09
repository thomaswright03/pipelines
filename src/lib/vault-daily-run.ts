// The daily automated Cold Outreach run, once each weekday morning: search
// new cities in the business list until enough businesses with an email address are
// found for the day's number, then pitch them, plus any an earlier run
// found but didn't get to. It has up to 300 s (LONG_RUN_BUDGETS) so the
// whole day's number goes out in one run. The run itself (time budgets, failure
// handling, status and summary) is shared with dataleadsell's daily run:
// see src/lib/outreach/daily-run.ts.
import { prisma } from "@/lib/db";
import { pickNextCity, markCityUsed } from "@/lib/vault-city-picker";
import { DAILY_RUN_SOURCE, LONG_RUN_BUDGETS, runDailyDiscoveryAndSend, UNSENT_DAILY, type DailyRunOptions } from "@/lib/outreach/daily-run";
import type { RunOutcome } from "@/lib/outreach/runs";

export { DAILY_RUN_SOURCE };

const DEFAULT_EMAILS_PER_DAY = 30;

/** How many sendable leads the next daily run will email (it only sends the ones daily runs found). */
export function countUnsentDailyLeads(): Promise<number> {
  return prisma.lead.count({ where: UNSENT_DAILY });
}

export function runDailyColdOutreach(emailsPerDay: number = DEFAULT_EMAILS_PER_DAY, options: DailyRunOptions = {}): Promise<RunOutcome> {
  return runDailyDiscoveryAndSend(
    {
      pipeline: "cold-outreach",
      search: { kind: "business" },
      listedNoun: { one: "business", many: "businesses" },
      foundNoun: "leads",
      pickTarget: () => pickNextCity(prisma),
      markTargetUsed: (target) => markCityUsed(prisma, target.city, target.state),
      describeTarget: (target) => `${target.city}, ${target.state}`,
      listUnsent: (take) =>
        prisma.lead.findMany({ where: UNSENT_DAILY, orderBy: { createdAt: "asc" }, select: { id: true, name: true }, take }),
    },
    emailsPerDay,
    { ...LONG_RUN_BUDGETS, ...options },
  );
}
