// The daily automated dataleadsell run: search the next agent city in the business list
// for real estate agents, check up to the configured number of them for an
// email address, save the ones an address was found for, then pitch every
// sendable agent the daily runs have found — this run's plus any an earlier
// run found but didn't get to. Same engine, budgets and rules as the Cold
// Outreach daily run (src/lib/outreach/daily-run.ts); off until turned on
// on the dataleadsell page.
import { prisma } from "@/lib/db";
import { pickNextAgentCity, markAgentCityUsed } from "@/lib/agent-city-picker";
import { runDailyDiscoveryAndSend, UNSENT_DAILY, type DailyRunOptions } from "@/lib/outreach/daily-run";
import type { RunOutcome } from "@/lib/outreach/runs";

/** Kept small so volume grows gradually and bounces stay low. */
const DEFAULT_AGENTS_PER_RUN = 10;

/** How many sendable agents the next daily run will email (it only sends the ones daily runs found). */
export function countUnsentDailyAgentLeads(): Promise<number> {
  return prisma.agentLead.count({ where: UNSENT_DAILY });
}

export function runDailyDataleadsell(agentsPerRun: number = DEFAULT_AGENTS_PER_RUN, options: DailyRunOptions = {}): Promise<RunOutcome> {
  return runDailyDiscoveryAndSend(
    {
      pipeline: "dataleadsell",
      search: { kind: "agent" },
      listedNoun: { one: "agent", many: "agents" },
      foundNoun: "agents",
      pickTarget: () => pickNextAgentCity(prisma),
      markTargetUsed: (target) => markAgentCityUsed(prisma, target.city, target.county, target.state),
      describeTarget: (target) => `${target.city} (${target.county} County, ${target.state})`,
      listUnsent: (take) =>
        prisma.agentLead.findMany({ where: UNSENT_DAILY, orderBy: { createdAt: "asc" }, select: { id: true, name: true }, take }),
    },
    agentsPerRun,
    options,
  );
}
