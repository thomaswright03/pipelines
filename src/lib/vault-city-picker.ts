import { PrismaClient } from "@/generated/prisma/client";
import { US_CITIES } from "@/lib/us-cities";

/**
 * Picks a random city that hasn't been scraped yet (tracked in
 * ScrapedCity). If every city in the pool has been used, the pool resets
 * rather than the scraper permanently running dry. Ported from Vault's
 * city-picker.ts. Doesn't record the pick itself — call markCityUsed once
 * the scrape actually succeeds, so a city that timed out or errored isn't
 * burned for nothing.
 */
export async function pickNextCity(prisma: PrismaClient): Promise<{ city: string; state: string; poolReset: boolean }> {
  const used = await prisma.scrapedCity.findMany({ select: { city: true, state: true } });
  const usedKeys = new Set(used.map((u) => `${u.city}, ${u.state}`));

  let available = US_CITIES.filter((c) => !usedKeys.has(`${c.city}, ${c.state}`));
  let poolReset = false;

  if (available.length === 0) {
    await prisma.scrapedCity.deleteMany({});
    available = US_CITIES;
    poolReset = true;
  }

  const picked = available[Math.floor(Math.random() * available.length)];

  return { ...picked, poolReset };
}

export async function markCityUsed(prisma: PrismaClient, city: string, state: string): Promise<void> {
  await prisma.scrapedCity.create({ data: { city, state } });
}
