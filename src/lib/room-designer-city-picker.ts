// The next city for the Room Designer 3D Yelp search (city-rotation.ts): the
// same pool and order as Cold Outreach, tracked separately in
// ScrapedRemodelerCity.
import type { PrismaClient } from "@/generated/prisma/client";
import { cityRotation } from "@/lib/city-rotation";
import { US_CITIES } from "@/lib/us-cities";

type City = { city: string; state: string };

const rotation = cityRotation<City>({
  pool: US_CITIES,
  key: (c) => `${c.city}, ${c.state}`,
  used: (db) => db.scrapedRemodelerCity.findMany({ select: { city: true, state: true } }),
  reset: (db) => db.scrapedRemodelerCity.deleteMany({}),
  record: (db, c) => db.scrapedRemodelerCity.create({ data: { city: c.city, state: c.state } }),
});

/** The city the next search will use. Read-only. */
export const peekNextRemodelerCity = (db: PrismaClient): Promise<City> => rotation.peek(db);

/** Picks the next city; call markRemodelerCityUsed once the search came back. */
export const pickNextRemodelerCity = (db: PrismaClient): Promise<City & { poolReset: boolean }> => rotation.pick(db);

export const markRemodelerCityUsed = (db: PrismaClient, city: string, state: string): Promise<void> =>
  rotation.markUsed(db, { city, state });
