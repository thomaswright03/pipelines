import { PrismaClient } from "@/generated/prisma/client";
import { US_CITIES } from "@/lib/us-cities";

/** A fixed, shuffled-looking order (FNV-1a hash of the name), so the next city can be shown before it's searched. */
export function cityOrderKey(name: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function firstInOrder<T>(pool: readonly T[], key: (item: T) => string): T {
  return pool.reduce((best, item) => (cityOrderKey(key(item)) < cityOrderKey(key(best)) ? item : best));
}

const cityKey = (c: { city: string; state: string }) => `${c.city}, ${c.state}`;

async function unusedCities(prisma: PrismaClient) {
  const used = await prisma.scrapedCity.findMany({ select: { city: true, state: true } });
  const usedKeys = new Set(used.map(cityKey));
  return US_CITIES.filter((c) => !usedKeys.has(cityKey(c)));
}

/**
 * The city "Find leads in the next city" (and the daily run) will search
 * next: the first city in a fixed shuffled order that hasn't been searched
 * yet (tracked in ScrapedCity). Read-only.
 */
export async function peekNextCity(prisma: PrismaClient): Promise<{ city: string; state: string }> {
  const available = await unusedCities(prisma);
  const { city, state } = firstInOrder(available.length > 0 ? available : US_CITIES, cityKey);
  return { city, state };
}

/**
 * Picks the next city (see peekNextCity). If every city in the pool has
 * been used, the pool resets rather than the scraper permanently running
 * dry. Doesn't record the pick itself — call markCityUsed once the scrape
 * actually succeeds, so a city that timed out or errored isn't burned for
 * nothing (it stays next in line).
 */
export async function pickNextCity(prisma: PrismaClient): Promise<{ city: string; state: string; poolReset: boolean }> {
  let available = await unusedCities(prisma);
  let poolReset = false;
  if (available.length === 0) {
    await prisma.scrapedCity.deleteMany({});
    available = US_CITIES;
    poolReset = true;
  }
  const { city, state } = firstInOrder(available, cityKey);
  return { city, state, poolReset };
}

export async function markCityUsed(prisma: PrismaClient, city: string, state: string): Promise<void> {
  await prisma.scrapedCity.create({ data: { city, state } });
}
