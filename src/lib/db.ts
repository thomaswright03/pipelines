import { PrismaClient } from "@/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Neon's own driver speaks Postgres over WebSockets, which is what lets the
 * app run on Vercel without a native query-engine binary. It can't talk to
 * an ordinary Postgres server, though, so anything that isn't a Neon host
 * (a local Postgres for development, the CI/test database) goes through the
 * standard `pg` driver instead. `PIPELINES_DB_DRIVER` overrides the guess.
 */
function usesNeonDriver(connectionString: string): boolean {
  const forced = process.env.PIPELINES_DB_DRIVER;
  if (forced === "neon") return true;
  if (forced === "pg") return false;
  try {
    return new URL(connectionString).hostname.endsWith(".neon.tech");
  } catch {
    return false;
  }
}

// Constructing the client never connects — the first query does — so a
// missing URL surfaces from src/instrumentation.ts's startup check rather
// than while `next build` imports route modules.
function createClient(): PrismaClient {
  const connectionString = process.env.PIPELINES_DATABASE_URL ?? "";
  const adapter = usesNeonDriver(connectionString)
    ? new PrismaNeon({ connectionString })
    : new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
