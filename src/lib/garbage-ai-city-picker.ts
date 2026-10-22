// The next city for the Garbage AI business-list search (city-rotation.ts): the same
// pool and order as Cold Outreach, tracked separately in ScrapedHaulerCity,
// and never a city in Mountain High's service area.
import type { PrismaClient } from "@/generated/prisma/client";
import { cityRotation } from "@/lib/city-rotation";
import { US_CITIES } from "@/lib/us-cities";
import { isMountainHighCity } from "@/lib/garbage-ai-targeting";

type City = { city: string; state: string };

const rotation = cityRotation<City>({
  pool: US_CITIES.filter((c) => !isMountainHighCity(c.city, c.state)),
  key: (c) => `${c.city}, ${c.state}`,
  used: (db) => db.scrapedHaulerCity.findMany({ select: { city: true, state: true } }),
  reset: (db) => db.scrapedHaulerCity.deleteMany({}),
  record: (db, c) => db.scrapedHaulerCity.create({ data: { city: c.city, state: c.state } }),
});

/** The city the next search will use. Read-only. */
export const peekNextHaulerCity = (db: PrismaClient): Promise<City> => rotation.peek(db);

/** Picks the next city; call markHaulerCityUsed once the search came back. */
export const pickNextHaulerCity = (db: PrismaClient): Promise<City & { poolReset: boolean }> => rotation.pick(db);

export const markHaulerCityUsed = (db: PrismaClient, city: string, state: string): Promise<void> => rotation.markUsed(db, { city, state });
