import type { NextRequest } from "next/server";
import { isAuthorizedBearer } from "@/lib/auth-header";
import { logError } from "@/lib/log";
import { isDatabaseUnavailable } from "@/lib/db-health";
import { recordRun } from "@/lib/outreach/runs";
import { routeStaleContacts, STALE_CONTACT_DAYS, type StaleContactResult } from "@/lib/outreach/stale-contacts";

// Daily (vercel.json): leads in either pipeline that were emailed 7+ days
// ago without a reply move to phone outreach. Vercel Cron sends
// CRON_SECRET as a bearer token; anything else is refused.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!isAuthorizedBearer(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    let routed: StaleContactResult | null = null;
    const run = await recordRun("all", "stale-contacts", async () => {
      const result = await routeStaleContacts();
      routed = result;
      const parts = Object.entries(result).map(
        ([pipeline, c]) => `${pipeline}: ${c.coldCall} to the cold-call list, ${c.contactless} to the no-phone-number list`,
      );
      return {
        status: "succeeded",
        summary: `Moved leads with no reply after ${STALE_CONTACT_DAYS} days — ${parts.join("; ")}.`,
      };
    });
    const failed = run.status === "failed";
    return Response.json({ ok: !failed, ...run, routed }, { status: failed ? 500 : 200 });
  } catch (err) {
    // The run couldn't even be recorded — most likely the database is
    // unreachable. The detail goes to the log, never into the response.
    const code = isDatabaseUnavailable(err) ? "db_unavailable" : "internal";
    logError("api.cron.stale-contacts", err, { code });
    const error =
      code === "db_unavailable"
        ? "The stale-contact job couldn't start: the database can't be reached. It will run again at its next scheduled time."
        : "The stale-contact job couldn't start because of an internal error. It will run again at its next scheduled time.";
    return Response.json({ ok: false, code, error }, { status: code === "db_unavailable" ? 503 : 500 });
  }
}
