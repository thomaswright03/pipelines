// The daily Garbage AI run and its "Find haulers" buttons: search one city
// on Yelp for waste haulers, drop the ones Garbage AI must never pitch (see
// garbage-ai-targeting.ts), check the rest for an email address on their own
// website, and save the ones an address was found for. The daily run then
// pitches the haulers daily runs found. It is the shared daily run
// (src/lib/outreach/daily-run.ts) — same pause and kill-switch handling,
// time budgets, send outcomes and run status as Cold Outreach and
// dataleadsell — with Garbage AI's search term, city picker, lead table and
// exclusion filter plugged in. While sending is held in code
// (garbage-ai-config.ts) the run still finds haulers but emails nobody.
import { prisma } from "@/lib/db";
import { findBusinessesViaYelp, type YelpCandidate } from "@/lib/yelp-discovery";
import { markHaulerCityUsed, pickNextHaulerCity } from "@/lib/garbage-ai-city-picker";
import { haulerExclusion } from "@/lib/garbage-ai-targeting";
import { GARBAGE_AI_YELP_TERM } from "@/lib/garbage-ai-config";
import { createLeadsFromCandidates, describeDiscovery, type DiscoveryCandidate, type DiscoveryResult } from "@/lib/outreach/discovery";
import { runDailyDiscoveryAndSend, type DailyRunOptions } from "@/lib/outreach/daily-run";
import type { RunOutcome } from "@/lib/outreach/runs";

export const GARBAGE_AI_DAILY_SOURCE = "Yelp search (daily Garbage AI run)";
const DEFAULT_EMAILS_PER_DAY = 30;

const LEFT_OUT_WHY = "current clients, national haulers, city departments, or in Mountain High's area";

/**
 * Splits Yelp results into the haulers Garbage AI may pitch (with their
 * Yelp categories as "services") and a count of the ones it never pitches.
 */
function screenHaulers(results: YelpCandidate[]): { kept: DiscoveryCandidate[]; excluded: number } {
  const kept = results.filter((r) => haulerExclusion(r) === null).map((r) => ({ ...r, services: r.categories.join(", ") || null }));
  return { kept, excluded: results.length - kept.length };
}

type SearchOutcome = {
  listed: number;
  excluded: number;
  discovery: DiscoveryResult;
};

/**
 * Searches one city for haulers and saves the ones an address was found
 * for, leaving out every hauler Garbage AI must never pitch. Yelp and the
 * lookups are the only outside calls; nothing is emailed here. (The "Find
 * haulers" buttons; the daily run goes through runDailyGarbageAi.)
 */
export async function searchHaulers(
  city: string,
  state: string,
  ctx: { source: string; maxCreate: number; deadline: number; now?: () => number },
): Promise<SearchOutcome> {
  const results = await findBusinessesViaYelp(GARBAGE_AI_YELP_TERM, `${city}, ${state}`);
  const { kept, excluded } = screenHaulers(results);
  const discovery = await createLeadsFromCandidates("garbage-ai", kept.slice(0, ctx.maxCreate), {
    city,
    state,
    source: ctx.source,
    maxCreate: ctx.maxCreate,
    deadline: ctx.deadline,
    now: ctx.now,
  });
  return { listed: results.length, excluded, discovery };
}

/** One line for the operator about what a hauler search did. */
export function describeHaulerSearch(where: string, outcome: SearchOutcome): string {
  const line = describeDiscovery("garbage-ai", where, outcome.listed, outcome.discovery);
  return outcome.excluded ? `${line} Left out ${outcome.excluded} that Garbage AI never pitches (${LEFT_OUT_WHY}).` : line;
}

const UNSENT_DAILY = { source: GARBAGE_AI_DAILY_SOURCE, status: "new", email: { not: null }, sendBlockedReason: null } as const;

/** How many haulers daily runs found that haven't been emailed. */
export function countUnsentDailyHaulers(): Promise<number> {
  return prisma.haulerLead.count({ where: UNSENT_DAILY });
}

export function runDailyGarbageAi(emailsPerDay: number = DEFAULT_EMAILS_PER_DAY, options: DailyRunOptions = {}): Promise<RunOutcome> {
  return runDailyDiscoveryAndSend(
    {
      pipeline: "garbage-ai",
      searchTerm: GARBAGE_AI_YELP_TERM,
      listedNoun: { one: "business", many: "businesses" },
      foundNoun: "haulers",
      source: GARBAGE_AI_DAILY_SOURCE,
      pickTarget: () => pickNextHaulerCity(prisma),
      markTargetUsed: (target) => markHaulerCityUsed(prisma, target.city, target.state),
      describeTarget: (target) => `${target.city}, ${target.state}`,
      listUnsent: (take) =>
        prisma.haulerLead.findMany({ where: UNSENT_DAILY, orderBy: { createdAt: "asc" }, select: { id: true, name: true }, take }),
      screen(results) {
        const { kept, excluded } = screenHaulers(results);
        return { kept, leftOut: excluded ? `left out ${excluded} that Garbage AI never pitches (${LEFT_OUT_WHY})` : null };
      },
    },
    emailsPerDay,
    options,
  );
}
