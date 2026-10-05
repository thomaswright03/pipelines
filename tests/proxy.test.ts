// With the database unreachable, a page request gets HTTP 503 and the
// outage page; the probe is reused for a few seconds so link prefetches
// don't each cost a database round trip.
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";

const reachable = vi.fn<() => Promise<boolean>>();
vi.mock("@/lib/db-health", () => ({ databaseReachable: () => reachable() }));

const { proxy, databaseReachableCached, resetProbeCache, config } = await import("@/proxy");
const { outageHtml } = await import("@/lib/outage-page");
const { THEME_INIT_SCRIPT } = await import("@/lib/theme");

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
    const html = await res.text();
    expect(html).toContain("Can't reach the database right now");
    expect(html).toContain(">Try again</a>");
  });

  it("dresses the outage page in the app's look: header mark, Geist, both themes and the theme picked in the header", async () => {
    const html = outageHtml(2026);
    // The wording is unchanged.
    expect(html).toContain(
      "Nothing can load or be saved until it's back — no emails are being sent in the meantime. Wait a minute,\n  then try again.",
    );
    expect(html).toContain('<span class="mark">O</span>Outreach');
    expect(html).toContain("© 2026 Wright AI Solutions LLC");
    expect(html).toContain(THEME_INIT_SCRIPT);
    expect(html).toContain(':root[data-theme="dark"]');
    expect(html).toContain('@media (prefers-color-scheme: dark) { :root:not([data-theme="light"])');
    // The font is a public file, which Proxy's matcher never answers with this page.
    expect(html).toContain("url(/fonts/geist-latin.woff2)");
    const font = readFileSync(path.resolve(__dirname, "../public/fonts/geist-latin.woff2"));
    expect(font.subarray(0, 4).toString("latin1")).toBe("wOF2");
    expect(new RegExp(config.matcher[0]!.replace(/^\//, "^/") + "$").test("/fonts/geist-latin.woff2")).toBe(false);
    expect(new RegExp(config.matcher[0]!.replace(/^\//, "^/") + "$").test("/dataleadsell")).toBe(true);
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
