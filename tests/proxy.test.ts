// With the database unreachable, a page request gets HTTP 503 and the
// outage page; the probe is reused for a few seconds so link prefetches
// don't each cost a database round trip.
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const reachable = vi.fn<() => Promise<boolean>>();
vi.mock("@/lib/db-health", () => ({ databaseReachable: () => reachable() }));

const { proxy, databaseReachableCached, resetProbeCache } = await import("@/proxy");

afterEach(() => {
  resetProbeCache();
  reachable.mockReset();
});

describe("proxy", () => {
  it("answers 503 with the outage page when the database can't be reached", async () => {
    reachable.mockResolvedValue(false);
    const res = await proxy(new NextRequest("http://localhost/dataleadsell"));
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(await res.text()).toContain("Can't reach the database right now");
  });

  it("lets the page render when the database is up", async () => {
    reachable.mockResolvedValue(true);
    const res = await proxy(new NextRequest("http://localhost/dataleadsell"));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("leaves form posts and server actions alone", async () => {
    const res = await proxy(new NextRequest("http://localhost/settings", { method: "POST" }));
    expect(reachable).not.toHaveBeenCalled();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("probes at most once every few seconds", async () => {
    reachable.mockResolvedValue(true);
    await databaseReachableCached(1_000);
    await databaseReachableCached(3_000);
    expect(reachable).toHaveBeenCalledTimes(1);
    await databaseReachableCached(7_000);
    expect(reachable).toHaveBeenCalledTimes(2);
  });
});
