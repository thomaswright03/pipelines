// A page request while the database is unreachable is answered with HTTP
// 503 and a plain outage page, so uptime monitors and scripts that check
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

const OUTAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Can't reach the database · Pipelines</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 16px;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background: #fafafa; color: #18181b; text-align: center; }
  @media (prefers-color-scheme: dark) { body { background: #09090b; color: #f4f4f5; } p.muted { color: #a1a1aa; } }
  main { max-width: 28rem; }
  h1 { font-size: 1.125rem; margin: 0 0 .75rem; }
  p.muted { color: #52525b; font-size: .875rem; line-height: 1.5; }
  a { display: inline-block; margin-top: .75rem; padding: .5rem 1rem; border-radius: .5rem; background: #4f46e5; color: #fff;
    text-decoration: none; font-weight: 600; font-size: .875rem; }
</style>
</head>
<body>
<main role="alert">
  <h1>Can't reach the database right now</h1>
  <p class="muted">Nothing can load or be saved until it's back — no emails are being sent in the meantime. Wait a minute,
  then try again. If it keeps happening, check the database provider's status page (Neon) or tell your developer.</p>
  <a href="">Try again</a>
</main>
</body>
</html>`;

export async function proxy(request: NextRequest) {
  if (request.method !== "GET" && request.method !== "HEAD") return NextResponse.next();
  if (await databaseReachableCached()) return NextResponse.next();
  return new NextResponse(OUTAGE_HTML, {
    status: 503,
    headers: { "content-type": "text/html; charset=utf-8", "retry-after": "60", "cache-control": "no-store" },
  });
}

export const config = {
  // Pages only: not the API (which reports outages itself), Next's assets or files with an extension.
  matcher: ["/((?!api/|_next/|.*\\.[a-zA-Z0-9]+$).*)"],
};
