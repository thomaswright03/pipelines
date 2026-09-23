import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { runDailyColdOutreach } from "@/lib/vault-daily-run";

// The actual fire TIME comes from vercel.json's cron schedule (Vercel
// Hobby cron can't be reconfigured without a redeploy — see
// PipelineSchedule in schema.prisma), but "enabled" and "leadCount" are
// read live from PipelineSchedule on every run, so those two knobs really
// are editable from the website with no redeploy needed.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const schedule = await prisma.pipelineSchedule.findUnique({ where: { id: "vault-pipeline" } });
  if (schedule && !schedule.enabled) {
    return Response.json({ skipped: true, reason: "Automation disabled in PipelineSchedule" });
  }

  const result = await runDailyColdOutreach(schedule?.leadCount);
  return Response.json(result);
}
