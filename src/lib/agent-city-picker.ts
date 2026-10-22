// The next (city, county) for dataleadsell's business-list agent search
// (city-rotation.ts), tracked in ScrapedAgentCity.
//
// Maricopa County now goes through the Arizona ADRE license roster
// (az-adre.ts) instead — a real, verified source the business list can't match.
// Utah's equivalent public data has no address/county field at all (see
// az-adre.ts's module comment), so Salt Lake and Utah counties still rely
// on this business-list picker.
import type { PrismaClient } from "@/generated/prisma/client";
import { cityRotation } from "@/lib/city-rotation";
import { AGENT_CITIES } from "@/lib/agent-cities";

type AgentCity = { city: string; county: string; state: string };

const rotation = cityRotation<AgentCity>({
  pool: AGENT_CITIES.filter((c) => c.county !== "Maricopa").map(({ city, county, state }) => ({ city, county, state })),
  key: (c) => `${c.city}, ${c.county}, ${c.state}`,
  used: (db) => db.scrapedAgentCity.findMany({ select: { city: true, county: true, state: true } }),
  reset: (db) => db.scrapedAgentCity.deleteMany({}),
  record: (db, c) => db.scrapedAgentCity.create({ data: { city: c.city, county: c.county, state: c.state } }),
});

/** The (city, county) "Find agents in the next city" will search next. Read-only. */
export const peekNextAgentCity = (db: PrismaClient): Promise<AgentCity> => rotation.peek(db);

/** Picks the next (city, county); call markAgentCityUsed once the search succeeded. */
export const pickNextAgentCity = (db: PrismaClient): Promise<AgentCity & { poolReset: boolean }> => rotation.pick(db);

export const markAgentCityUsed = (db: PrismaClient, city: string, county: string, state: string): Promise<void> =>
  rotation.markUsed(db, { city, county, state });
