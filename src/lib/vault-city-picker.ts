// The next city for Cold Outreach's Yelp search (city-rotation.ts), tracked
// in ScrapedCity.
import type { PrismaClient } from "@/generated/prisma/client";
import { cityRotation } from "@/lib/city-rotation";
import { US_CITIES } from "@/lib/us-cities";

type City = { city: string; state: string };

const rotation = cityRotation<City>({
  pool: US_CITIES,
  key: (c) => `${c.city}, ${c.state}`,
  used: (db) => db.scrapedCity.findMany({ select: { city: true, state: true } }),
  reset: (db) => db.scrapedCity.deleteMany({}),
  record: (db, c) => db.scrapedCity.create({ data: { city: c.city, state: c.state } }),
});

/** The city "Find leads in the next city" (and the daily run) will search next. Read-only. */
export const peekNextCity = (db: PrismaClient): Promise<City> => rotation.peek(db);

/** Picks the next city; call markCityUsed once the search succeeded. */
export const pickNextCity = (db: PrismaClient): Promise<City & { poolReset: boolean }> => rotation.pick(db);

export const markCityUsed = (db: PrismaClient, city: string, state: string): Promise<void> => rotation.markUsed(db, { city, state });
