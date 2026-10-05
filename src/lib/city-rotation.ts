// The city each pipeline's "find in the next city" button and daily run
// searches next: the first city of its pool, in a fixed shuffled-looking
// order, that hasn't been searched yet (tracked in that pipeline's own
// table). When the pool is used up it starts over rather than running dry.
// The pick isn't recorded until the search actually came back (markUsed),
// so a city that timed out or errored stays next in line.
//
// Each pipeline's picker (vault-city-picker.ts, agent-city-picker.ts,
// garbage-ai-city-picker.ts) only says which pool and which table.
import type { PrismaClient } from "@/generated/prisma/client";

/** A fixed, shuffled-looking order (FNV-1a hash of the name), so the next city can be shown before it's searched. */
export function cityOrderKey(name: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

type RotationSpec<C> = {
  /** Every city this pipeline may search. */
  pool: readonly C[];
  /** What makes two cities the same (and orders the pool). */
  key: (city: C) => string;
  /** The cities already searched since the pool last started over. */
  used: (db: PrismaClient) => Promise<C[]>;
  /** Forgets every searched city (the pool starts over). */
  reset: (db: PrismaClient) => Promise<unknown>;
  /** Records a city as searched. */
  record: (db: PrismaClient, city: C) => Promise<unknown>;
};

export type CityRotation<C> = {
  /** The city the next search will use. Read-only. */
  peek(db: PrismaClient): Promise<C>;
  /** The next city to search; starts the pool over when every city has been used. Doesn't record it (see markUsed). */
  pick(db: PrismaClient): Promise<C & { poolReset: boolean }>;
  /** Records the city once its search came back. */
  markUsed(db: PrismaClient, city: C): Promise<void>;
};

export function cityRotation<C extends object>(spec: RotationSpec<C>): CityRotation<C> {
  const firstInOrder = (cities: readonly C[]): C =>
    cities.reduce((best, city) => (cityOrderKey(spec.key(city)) < cityOrderKey(spec.key(best)) ? city : best));
  async function unused(db: PrismaClient): Promise<C[]> {
    const used = new Set((await spec.used(db)).map(spec.key));
    return spec.pool.filter((city) => !used.has(spec.key(city)));
  }
  return {
    async peek(db) {
      const available = await unused(db);
      return { ...firstInOrder(available.length > 0 ? available : spec.pool) };
    },
    async pick(db) {
      let available = await unused(db);
      let poolReset = false;
      if (available.length === 0) {
        await spec.reset(db);
        available = [...spec.pool];
        poolReset = true;
      }
      return { ...firstInOrder(available), poolReset };
    },
    async markUsed(db, city) {
      await spec.record(db, city);
    },
  };
}
