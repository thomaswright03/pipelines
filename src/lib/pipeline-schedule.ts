// Daily-automation settings (see PipelineSchedule in schema.prisma). The
// fire time is fixed in vercel.json; only "enabled" and "leads per run"
// are live settings. Validation rules: ./pipeline-schedule-rules.ts.
import { prisma } from "@/lib/db";
import type { PipelineScheduleData } from "@/lib/pipeline-schedule-rules";

export {
  scheduleSchema,
  VAULT_DAILY_RUN_TIME_LABEL,
  VAULT_SCHEDULE_ID,
  type PipelineScheduleData,
} from "@/lib/pipeline-schedule-rules";

const DEFAULT_SCHEDULE: PipelineScheduleData = { enabled: true, leadCount: 30 };

export async function getPipelineSchedule(pipelineId: string): Promise<PipelineScheduleData> {
  const row = await prisma.pipelineSchedule.findUnique({ where: { id: pipelineId } });
  if (!row) return DEFAULT_SCHEDULE;
  return { enabled: row.enabled, leadCount: row.leadCount };
}

export async function savePipelineSchedule(pipelineId: string, data: PipelineScheduleData): Promise<void> {
  await prisma.pipelineSchedule.upsert({ where: { id: pipelineId }, create: { id: pipelineId, ...data }, update: data });
}
