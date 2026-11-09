// Business discovery from Foursquare's open places data, kept in our own
// Place table (loaded once a month by scripts/import-places.py) so a
// search is one database query: no API key, no per-call cost, and the data
// may be kept and used for outreach (Apache 2.0). It replaced Yelp's API,
// whose trial ended in October 2026 and whose terms forbid both.
//
// Google Maps listings for the haulers, remodelers and agents searches are
// loaded into the same table every month (scripts/import-google-places.py).
// They carry that month's date, so a search lists them before the older
// Foursquare places; a business in both is skipped the second time by the
// usual same-name check.
//
// Unlike Yelp, most places come with the business's own website, so the
// email lookup can read the real site instead of guessing it. The data is
// refreshed monthly, not live, so some places will have closed since.
import { prisma } from "@/lib/db";
import { logError } from "@/lib/log";
import type { Prisma } from "@/generated/prisma/client";

export type PlaceCandidate = {
  name: string;
  phone: string | null;
  address: string | null;
  website: string | null;
  /** Foursquare's category names for the business ("Waste Management Service", "Bathroom Contractor"). */
  categories: string[];
};

/** Which pipeline's search a place was loaded for (see the import script). */
export type PlaceKind = "hauler" | "remodeler" | "agent" | "business";

/** A kind of business, or free words matched against names and categories (the manual Cold Outreach search). */
export type PlaceSearch = { kind: PlaceKind } | { words: string };

/** Ids of the rows scripts/import-google-places.py loads from Google Maps; the rest are Foursquare's. */
export const GOOGLE_ID_PREFIX = "g:";

const DEFAULT_LIMIT = 50; // Matches what one Yelp search returned, and our own per-run cap.

/**
 * A search that couldn't run, with a message written for the operator.
 * `message` is for a search someone just pressed a button for;
 * `unattended` is for a daily run, where there's nothing to "try again".
 */
export class PlaceSearchError extends Error {
  readonly unattended: string;
  constructor(message: string, unattended: string = message) {
    super(message);
    this.name = "PlaceSearchError";
    this.unattended = unattended;
  }
}

export const PLACES_NOT_LOADED =
  "The business list hasn't been loaded yet, so the search can't find anyone — ask your developer to run the monthly business import.";

/**
 * Finds up to `limit` businesses in a city, most recently confirmed by
 * Foursquare first. An empty list means the city is loaded but has none
 * of that kind; a city that isn't in the loaded data at all is an error,
 * so a typo or an unsupported city isn't mistaken for "nobody there".
 */
export async function findBusinesses(
  search: PlaceSearch,
  city: string,
  state: string,
  options: { limit?: number } = {},
): Promise<PlaceCandidate[]> {
  const where = { city: { equals: city.trim(), mode: "insensitive" }, state: state.trim().toUpperCase() } satisfies Prisma.PlaceWhereInput;
  let rows;
  try {
    const take = Math.max(1, options.limit ?? DEFAULT_LIMIT);
    const words = "words" in search ? search.words.trim() : "";
    rows = words
      ? await searchByWords(words, where.city.equals, where.state, take)
      : await prisma.place.findMany({
          where: { ...where, kinds: { has: "kind" in search ? search.kind : "business" } },
          orderBy: [{ refreshedAt: { sort: "desc", nulls: "last" } }, { id: "asc" }],
          take,
          select: { name: true, phone: true, address: true, website: true, categories: true },
        });
    if (rows.length === 0 && (await prisma.place.count({ where })) === 0) {
      if ((await prisma.place.count()) === 0) throw new PlaceSearchError(PLACES_NOT_LOADED);
      throw new PlaceSearchError(
        `${city}, ${state} isn't in the loaded business list — only the cities the daily runs rotate through are loaded. Check the spelling, or pick one of those cities.`,
        `${city}, ${state} isn't in the loaded business list, so no new leads were found there. Tell your developer if this keeps happening.`,
      );
    }
  } catch (err) {
    if (err instanceof PlaceSearchError) throw err;
    logError("places.search", err, { city, state });
    throw new PlaceSearchError(
      "Couldn't read the business list right now — try again in a minute.",
      "Couldn't read the business list, so no new leads were found this time. The next daily run tries again automatically; if this happens two days in a row, tell your developer.",
    );
  }
  return rows.map((r) => ({ ...r, name: r.name.trim() }));
}

// Free words ("plumber", "roofing") match any part of the name or of a
// category label, in any kind of place loaded for the city. A plural
// ("plumbers") also matches its singular.
function searchByWords(words: string, city: string, state: string, take: number): Promise<PlaceCandidate[]> {
  const like = (w: string) => `%${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const pattern = like(words);
  const singular = like(/[^s]s$/i.test(words) && words.length > 3 ? words.slice(0, -1) : words);
  return prisma.$queryRaw<PlaceCandidate[]>`
    SELECT "name", "phone", "address", "website", "categories" FROM "Place"
    WHERE lower("city") = lower(${city}) AND "state" = ${state}
      AND ("name" ILIKE ${pattern} OR array_to_string("categories", ' | ') ILIKE ${pattern}
        OR "name" ILIKE ${singular} OR array_to_string("categories", ' | ') ILIKE ${singular})
    ORDER BY "refreshedAt" DESC NULLS LAST, "id" ASC
    LIMIT ${take}`;
}

/** What Settings → Connections shows about the loaded data. */
export async function placesSummary(): Promise<{ places: number; fromGoogle: number; cities: number; importedAt: Date | null }> {
  const [places, fromGoogle, cities, latest] = await Promise.all([
    prisma.place.count(),
    prisma.place.count({ where: { id: { startsWith: GOOGLE_ID_PREFIX } } }),
    prisma.place.groupBy({ by: ["state", "city"] }).then((g) => g.length),
    prisma.place.aggregate({ _max: { importedAt: true } }),
  ]);
  return { places, fromGoogle, cities, importedAt: latest._max.importedAt };
}
