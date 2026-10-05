// A page request while the database is unreachable is answered with HTTP
// 503 and an outage page, so uptime monitors and scripts that check
// pages see the outage. (Once a page starts streaming its status can't
// change, which is why this happens here, before rendering; the layout's
// in-page outage message covers the database dropping mid-render.)
//
// Next strips its RSC headers before Proxy, so in-app navigations and
// prefetches come through here too: during an outage they get the 503 and
// the browser falls back to loading the outage page. To keep that from
// costing a database round trip per link prefetch, the probe's answer is
// reused for a few seconds.
import { NextResponse, type NextRequest } from "next/server";
import { databaseReachable } from "@/lib/db-health";
import { outageHtml } from "@/lib/outage-page";

const PROBE_TTL_MS = 5_000;
let lastProbe: { at: number; reachable: Promise<boolean> } | null = null;

/** Whether the database answered recently, probing at most once per few seconds. */
export function databaseReachableCached(now: number = Date.now(), probe: () => Promise<boolean> = databaseReachable): Promise<boolean> {
  if (!lastProbe || now - lastProbe.at > PROBE_TTL_MS) lastProbe = { at: now, reachable: probe() };
  return lastProbe.reachable;
}

/** Test hook: forget the cached probe. */
export function resetProbeCache(): void {
  lastProbe = null;
}

export async function proxy(request: NextRequest) {
  if (request.method !== "GET" && request.method !== "HEAD") return NextResponse.next();
  if (await databaseReachableCached()) return NextResponse.next();
  return new NextResponse(outageHtml(), {
    status: 503,
    headers: { "content-type": "text/html; charset=utf-8", "retry-after": "60", "cache-control": "no-store" },
  });
}

export const config = {
  // Pages only: not the API (which reports outages itself), Next's assets or files with an extension.
  matcher: ["/((?!api/|_next/|.*\\.[a-zA-Z0-9]+$).*)"],
};
