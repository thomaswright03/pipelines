import { databaseReachable } from "@/lib/db-health";

// Whether the database is reachable, for the error page (which can't see
// server error details in production) and for uptime checks. Reveals
// nothing beyond "ok" / "unreachable".
export const dynamic = "force-dynamic";

export async function GET() {
  const ok = await databaseReachable();
  return Response.json({ database: ok ? "ok" : "unreachable" }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
