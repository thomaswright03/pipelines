// "Can the app reach its database right now?" — so an outage is reported
// as an outage (in the page body, to the email Worker) rather than as a
// generic error.
import { prisma } from "@/lib/db";
import { logError } from "@/lib/log";

const PROBE_TIMEOUT_MS = 4_000;

/** Prisma's "can't reach the database" family (P1001 and friends), or a dropped connection. */
export function isDatabaseUnavailable(err: unknown): boolean {
  const e = err as { code?: unknown; errorCode?: unknown; name?: unknown } | null;
  const code = e?.code ?? e?.errorCode;
  if (typeof code === "string" && /^(?:P1001|P1002|P1017|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN)$/.test(code)) return true;
  if (e?.name === "PrismaClientInitializationError") return true;
  return /can't reach database|connection (?:refused|terminated)|ECONNREFUSED|ENOTFOUND|timeout exceeded when trying to connect/i.test(
    String(err),
  );
}

export const DATABASE_UNAVAILABLE_MESSAGE =
  "Can't reach the database right now, so this didn't go through. Wait a minute and try again; if it keeps happening, check the database provider's status page (Neon) or ask your developer.";

/**
 * What a form or button shows when its action failed unexpectedly: the
 * outage message when the database couldn't be reached (the same advice as
 * the outage page), otherwise `fallback`.
 */
export function failureMessage(err: unknown, fallback: string): string {
  return isDatabaseUnavailable(err) ? DATABASE_UNAVAILABLE_MESSAGE : fallback;
}

/** Whether a trivial query succeeds within a few seconds. Never throws. */
export async function databaseReachable(): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("database probe timed out")), PROBE_TIMEOUT_MS);
      }),
    ]);
    return true;
  } catch (err) {
    logError("db.health", err);
    return false;
  } finally {
    clearTimeout(timer);
  }
}
