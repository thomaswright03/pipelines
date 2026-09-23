// Next.js loads .env on its own, but this module is also imported by
// standalone scripts (tsx doesn't auto-load .env) — see python-script.ts's
// version of this same comment for the class of bug this avoids.
import "dotenv/config";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// A driver adapter (Neon's own HTTP/WebSocket driver, not a TCP pool) means
// no native query-engine binary at all — the actual fix for "could not
// locate the Query Engine for runtime rhel-openssl-3.0.x" on Vercel, not a
// binaryTargets workaround. Same pattern bizhub (Vault) uses with Turso's
// libsql adapter, just Neon's Postgres equivalent.
function createClient() {
  const adapter = new PrismaNeon({ connectionString: process.env.PIPELINES_DATABASE_URL! });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
