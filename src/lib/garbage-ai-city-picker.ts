// The next city for the Garbage AI Yelp search: the same fixed pool and
// order as Cold Outreach (see vault-city-picker.ts), tracked separately in
// ScrapedHaulerCity, and never a city in Mountain High's service area.
import { PrismaClient } from "@/generated/prisma/client";
import { US_CITIES } from "@/lib/us-cities";
import { cityOrderKey } from "@/lib/vault-city-picker";
import { isMountainHighCity } from "@/lib/garbage-ai-targeting";

const cityKey = (c: { city: string; state: string }) => `${c.city}, ${c.state}`;
const POOL = US_CITIES.filter((c) => !isMountainHighCity(c.city, c.state));

function firstInOrder(pool: readonly { city: string; state: string }[]) {
  const best = pool.reduce((a, b) => (cityOrderKey(cityKey(b)) < cityOrderKey(cityKey(a)) ? b : a));
  return { city: best.city, state: best.state };
}

async function unusedCities(prisma: PrismaClient) {
  const used = new Set((await prisma.scrapedHaulerCity.findMany({ select: { city: true, state: true } })).map(cityKey));
  return POOL.filter((c) => !used.has(cityKey(c)));
}

/** The city the next search will use. Read-only. */
export async function peekNextHaulerCity(prisma: PrismaClient): Promise<{ city: string; state: string }> {
  const available = await unusedCities(prisma);
  return firstInOrder(available.length > 0 ? available : POOL);
}

/** Picks the next city; when the pool is used up it starts over. Call markHaulerCityUsed once the search came back. */
export async function pickNextHaulerCity(prisma: PrismaClient): Promise<{ city: string; state: string; poolReset: boolean }> {
  let available = await unusedCities(prisma);
  let poolReset = false;
  if (available.length === 0) {
    await prisma.scrapedHaulerCity.deleteMany({});
    available = POOL;
    poolReset = true;
  }
  return { ...firstInOrder(available), poolReset };
}

export async function markHaulerCityUsed(prisma: PrismaClient, city: string, state: string): Promise<void> {
  await prisma.scrapedHaulerCity.create({ data: { city, state } });
}
