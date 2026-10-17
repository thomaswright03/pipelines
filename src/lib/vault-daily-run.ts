// The daily automated Cold Outreach run: search one new city on Yelp,
// check up to the configured number of those businesses for an email
// address, save the ones an address was found for, then pitch every
// sendable lead the daily runs have found — this run's plus any an earlier
// run found but didn't get to. The run itself (time budgets, failure
// handling, status and summary) is shared with dataleadsell's daily run:
// see src/lib/outreach/daily-run.ts.
import { prisma } from "@/lib/db";
import { pickNextCity, markCityUsed } from "@/lib/vault-city-picker";
import { DAILY_RUN_SOURCE, runDailyDiscoveryAndSend, UNSENT_DAILY, type DailyRunOptions } from "@/lib/outreach/daily-run";
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
      searchTerm: "",
      listedNoun: { one: "business", many: "businesses" },
      foundNoun: "leads",
      pickTarget: () => pickNextCity(prisma),
      markTargetUsed: (target) => markCityUsed(prisma, target.city, target.state),
      describeTarget: (target) => `${target.city}, ${target.state}`,
      listUnsent: (take) =>
        prisma.lead.findMany({ where: UNSENT_DAILY, orderBy: { createdAt: "asc" }, select: { id: true, name: true }, take }),
    },
    emailsPerDay,
    options,
  );
}
