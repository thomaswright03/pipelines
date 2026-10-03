import type { NextRequest } from "next/server";
import { isAuthorizedBearer } from "@/lib/auth-header";
import { logError } from "@/lib/log";
import { isDatabaseUnavailable } from "@/lib/db-health";
import { prisma } from "@/lib/db";
import { recordRun } from "@/lib/outreach/runs";
import { buildDailyReport, DAILY_REPORT_FROM, DAILY_REPORT_TO, renderDailyReport } from "@/lib/daily-report";
import { classifySendError, sendReportEmail } from "@/lib/send-email";

// The daily report email (vercel.json: "0 17 * * *", 10:00 AM Arizona time):
// how every pipeline ran in the last 24 hours, one email with a section per
// pipeline. Recorded in PipelineRun like the other crons.
export const maxDuration = 60;

/** Vercel can deliver a cron invocation twice; a report already sent this recently isn't sent again. */
const RESEND_GUARD_MS = 20 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  if (!isAuthorizedBearer(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date();
    const run = await recordRun("all", "daily-report", async (runId) => {
      const alreadySent = await prisma.pipelineRun.findFirst({
        where: {
          kind: "daily-report",
          status: "succeeded",
          id: { not: runId },
          startedAt: { gte: new Date(now.getTime() - RESEND_GUARD_MS) },
        },
      });
      if (alreadySent) return { status: "skipped", summary: "Today's report was already sent." };

      const { subject, text } = renderDailyReport(await buildDailyReport(now));
      try {
        await sendReportEmail(DAILY_REPORT_FROM, DAILY_REPORT_TO, subject, text);
      } catch (err) {
        logError("api.cron.daily-report.send", err);
        return { status: "failed", summary: "The daily report couldn't be emailed.", errors: [classifySendError(err).message] };
      }
      return { status: "succeeded", summary: `Sent the daily report to ${DAILY_REPORT_TO}: "${subject}".` };
    });
    const failed = run.status === "failed";
    return Response.json({ ok: !failed, ...run }, { status: failed ? 500 : 200 });
  } catch (err) {
    const code = isDatabaseUnavailable(err) ? "db_unavailable" : "internal";
    logError("api.cron.daily-report", err, { code });
    const error =
      code === "db_unavailable"
        ? "The daily report couldn't be built: the database can't be reached. It will run again at its next scheduled time."
        : "The daily report couldn't be built because of an internal error. It will run again at its next scheduled time.";
    return Response.json({ ok: false, code, error }, { status: code === "db_unavailable" ? 503 : 500 });
  }
}
