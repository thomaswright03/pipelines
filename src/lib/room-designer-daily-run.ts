// The daily Room Designer 3D run and its "Find remodelers" buttons: search
// one city in the business list for bathroom remodelers, drop the ones Room Designer 3D
// must never pitch (see room-designer-targeting.ts), check the rest for an
// email address on their own website, and save the ones an address was
// found for. The daily run then pitches the remodelers daily runs found. It
// is the shared daily run (src/lib/outreach/daily-run.ts) — same pause and
// kill-switch handling, send outcomes and run status as the other
// pipelines — run once each weekday with Cold Outreach's long time budget
// (LONG_RUN_BUDGETS). While sending is held in code (room-designer-config.ts)
// the run still finds remodelers but emails nobody.
import { prisma } from "@/lib/db";
import { findBusinesses, type PlaceCandidate } from "@/lib/place-discovery";
import { markRemodelerCityUsed, pickNextRemodelerCity } from "@/lib/room-designer-city-picker";
import { remodelerExclusion } from "@/lib/room-designer-targeting";
import { createLeadsFromCandidates, describeDiscovery, type DiscoveryCandidate, type DiscoveryResult } from "@/lib/outreach/discovery";
import { LONG_RUN_BUDGETS, runDailyDiscoveryAndSend, type DailyRunOptions } from "@/lib/outreach/daily-run";
import type { RunOutcome } from "@/lib/outreach/runs";

export const ROOM_DESIGNER_DAILY_SOURCE = "Business list (daily Room Designer 3D run)";
/** Every `source` a daily run has saved, including leads found on Yelp before October 2026. */
export const ROOM_DESIGNER_DAILY_SOURCES = [ROOM_DESIGNER_DAILY_SOURCE, "Yelp search (daily Room Designer 3D run)"];
const DEFAULT_EMAILS_PER_DAY = 10;

const LEFT_OUT_WHY = "franchises, big-box installers, plumbers, supply houses, showrooms or Thomas's client";

/**
 * Splits search results into the remodelers Room Designer 3D may pitch (with
 * their Foursquare categories as "services") and a count of the ones it never pitches.
 */
function screenRemodelers(results: PlaceCandidate[]): { kept: DiscoveryCandidate[]; excluded: number } {
  const kept = results.filter((r) => remodelerExclusion(r) === null).map((r) => ({ ...r, services: r.categories.join(", ") || null }));
  return { kept, excluded: results.length - kept.length };
}

type SearchOutcome = {
  listed: number;
  excluded: number;
  discovery: DiscoveryResult;
};

/**
 * Searches one city for remodelers and saves the ones an address was found
 * for, leaving out every one Room Designer 3D must never pitch. The business list and
 * the lookups are the only outside calls; nothing is emailed here. (The
 * "Find remodelers" buttons; the daily run goes through runDailyRoomDesigner.)
 */
export async function searchRemodelers(
  city: string,
  state: string,
  ctx: { source: string; maxCreate: number; deadline: number; now?: () => number },
): Promise<SearchOutcome> {
  const results = await findBusinesses({ kind: "remodeler" }, city, state);
  const { kept, excluded } = screenRemodelers(results);
  const discovery = await createLeadsFromCandidates("room-designer", kept.slice(0, ctx.maxCreate), {
    city,
    state,
    source: ctx.source,
    maxCreate: ctx.maxCreate,
    deadline: ctx.deadline,
    now: ctx.now,
  });
  return { listed: results.length, excluded, discovery };
}

/** One line for the operator about what a remodeler search did. */
export function describeRemodelerSearch(where: string, outcome: SearchOutcome): string {
  const line = describeDiscovery("room-designer", where, outcome.listed, outcome.discovery);
  return outcome.excluded ? `${line} Left out ${outcome.excluded} that Room Designer 3D never pitches (${LEFT_OUT_WHY}).` : line;
}

const UNSENT_DAILY = { source: { in: ROOM_DESIGNER_DAILY_SOURCES }, status: "new", email: { not: null }, sendBlockedReason: null } as const;

/** How many remodelers daily runs found that haven't been emailed. */
export function countUnsentDailyRemodelers(): Promise<number> {
  return prisma.remodelerLead.count({ where: UNSENT_DAILY });
}

export function runDailyRoomDesigner(emailsPerDay: number = DEFAULT_EMAILS_PER_DAY, options: DailyRunOptions = {}): Promise<RunOutcome> {
  return runDailyDiscoveryAndSend(
    {
      pipeline: "room-designer",
      search: { kind: "remodeler" },
      listedNoun: { one: "business", many: "businesses" },
      foundNoun: "remodelers",
      source: ROOM_DESIGNER_DAILY_SOURCE,
      pickTarget: () => pickNextRemodelerCity(prisma),
      markTargetUsed: (target) => markRemodelerCityUsed(prisma, target.city, target.state),
      describeTarget: (target) => `${target.city}, ${target.state}`,
      listUnsent: (take) =>
        prisma.remodelerLead.findMany({ where: UNSENT_DAILY, orderBy: { createdAt: "asc" }, select: { id: true, name: true }, take }),
      screen(results) {
        const { kept, excluded } = screenRemodelers(results);
        return { kept, leftOut: excluded ? `left out ${excluded} that Room Designer 3D never pitches (${LEFT_OUT_WHY})` : null };
      },
    },
    emailsPerDay,
    { ...LONG_RUN_BUDGETS, ...options },
  );
}
