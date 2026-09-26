import { PrismaClient } from "@/generated/prisma/client";
import { AGENT_CITIES } from "@/lib/agent-cities";
import { cityOrderKey } from "@/lib/vault-city-picker";

// Maricopa County now goes through the Arizona ADRE license roster
// (az-adre.ts) instead of Yelp — a real, verified source Yelp can't match.
// Utah's equivalent public data has no address/county field at all (see
// az-adre.ts's module comment), so Salt Lake and Utah counties still rely
// on this Yelp-based picker.
const YELP_AGENT_CITIES = AGENT_CITIES.filter((c) => c.county !== "Maricopa");

const agentCityKey = (c: { city: string; county: string; state: string }) => `${c.city}, ${c.county}, ${c.state}`;

function firstInOrder<T extends { city: string; county: string; state: string }>(pool: readonly T[]): T {
  return pool.reduce((best, item) => (cityOrderKey(agentCityKey(item)) < cityOrderKey(agentCityKey(best)) ? item : best));
}

async function unusedAgentCities(prisma: PrismaClient) {
  const used = await prisma.scrapedAgentCity.findMany({ select: { city: true, county: true, state: true } });
  const usedKeys = new Set(used.map(agentCityKey));
  return YELP_AGENT_CITIES.filter((c) => !usedKeys.has(agentCityKey(c)));
}

/** The (city, county) "Find agents in the next city" will search next. Read-only. */
export async function peekNextAgentCity(prisma: PrismaClient): Promise<{ city: string; county: string; state: string }> {
  const available = await unusedAgentCities(prisma);
  const { city, county, state } = firstInOrder(available.length > 0 ? available : YELP_AGENT_CITIES);
  return { city, county, state };
}

/**
 * Picks the next (city, county) not yet searched for agent leads, in the
 * same fixed order as vault-city-picker.ts. Resets the pool once every
 * target city has been used. Doesn't record the pick itself; call
 * markAgentCityUsed once the scrape actually succeeds.
 */
export async function pickNextAgentCity(
  prisma: PrismaClient,
): Promise<{ city: string; county: string; state: string; poolReset: boolean }> {
  let available = await unusedAgentCities(prisma);
  let poolReset = false;
  if (available.length === 0) {
    await prisma.scrapedAgentCity.deleteMany({});
    available = YELP_AGENT_CITIES;
    poolReset = true;
  }
  const { city, county, state } = firstInOrder(available);
  return { city, county, state, poolReset };
}

export async function markAgentCityUsed(prisma: PrismaClient, city: string, county: string, state: string): Promise<void> {
  await prisma.scrapedAgentCity.create({ data: { city, county, state } });
}
