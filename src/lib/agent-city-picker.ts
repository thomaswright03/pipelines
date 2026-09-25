import { PrismaClient } from "@/generated/prisma/client";
import { AGENT_CITIES } from "@/lib/agent-cities";

// Maricopa County now goes through the Arizona ADRE license roster
// (az-adre.ts) instead of Yelp — a real, verified source Yelp can't match.
// Utah's equivalent public data has no address/county field at all (see
// az-adre.ts's module comment), so Salt Lake and Utah counties still rely
// on this Yelp-based picker.
const YELP_AGENT_CITIES = AGENT_CITIES.filter((c) => c.county !== "Maricopa");

/**
 * Picks a random (city, county) that hasn't been scraped yet for agent
 * leads. Resets the pool once every target city has been used — same
 * pattern as Vault's city-picker.ts. Doesn't record the pick itself; call
 * markAgentCityUsed once the scrape actually succeeds.
 */
export async function pickNextAgentCity(
  prisma: PrismaClient,
): Promise<{ city: string; county: string; state: string; poolReset: boolean }> {
  const used = await prisma.scrapedAgentCity.findMany({ select: { city: true, county: true, state: true } });
  const usedKeys = new Set(used.map((u) => `${u.city}, ${u.county}, ${u.state}`));

  let available = YELP_AGENT_CITIES.filter((c) => !usedKeys.has(`${c.city}, ${c.county}, ${c.state}`));
  let poolReset = false;

  if (available.length === 0) {
    await prisma.scrapedAgentCity.deleteMany({});
    available = YELP_AGENT_CITIES;
    poolReset = true;
  }

  const picked = available[Math.floor(Math.random() * available.length)];
  return { ...picked, poolReset };
}

export async function markAgentCityUsed(prisma: PrismaClient, city: string, county: string, state: string): Promise<void> {
  await prisma.scrapedAgentCity.create({ data: { city, county, state } });
}
