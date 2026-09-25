// A database outage is reported as an outage — by /api/health (which the
// error page asks) and to the email Worker — never with internal details.
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { databaseReachable, isDatabaseUnavailable } from "@/lib/db-health";
import { GET } from "@/app/api/health/route";
import * as log from "@/lib/log";

afterEach(() => vi.restoreAllMocks());

describe("database health", () => {
  it("recognises Prisma's can't-reach-the-database errors and dropped connections, not other failures", () => {
    expect(isDatabaseUnavailable(Object.assign(new Error("Can't reach database server at db:5432"), { code: "P1001" }))).toBe(true);
    expect(isDatabaseUnavailable(Object.assign(new Error("x"), { name: "PrismaClientInitializationError" }))).toBe(true);
    expect(isDatabaseUnavailable(new Error("connect ECONNREFUSED 127.0.0.1:5432"))).toBe(true);
    expect(isDatabaseUnavailable(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }))).toBe(false);
    expect(isDatabaseUnavailable(new TypeError("undefined is not a function"))).toBe(false);
  });

  it("/api/health answers ok while the database is up, and 503 'unreachable' — with nothing else — when it isn't", async () => {
    const up = await GET();
    expect(up.status).toBe(200);
    expect(await up.json()).toEqual({ database: "ok" });

    vi.spyOn(log, "logError").mockImplementation(() => {});
    vi.spyOn(prisma, "$queryRaw").mockRejectedValue(Object.assign(new Error("Can't reach database server at secret-host:5432"), { code: "P1001" }));
    expect(await databaseReachable()).toBe(false);
    const down = await GET();
    expect(down.status).toBe(503);
    expect(await down.json()).toEqual({ database: "unreachable" });
  });
});
