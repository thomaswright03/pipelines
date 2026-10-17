// Daily-automation settings (see PipelineSchedule in schema.prisma). The
// fire time is fixed in vercel.json; only "enabled" and "businesses to
// check per run" are live settings. Validation rules: ./pipeline-schedule-rules.ts.
import { prisma } from "@/lib/db";
import { EMAILS_PER_DAY_MAX, DATALEADSELL_SCHEDULE_ID, type PipelineScheduleData } from "@/lib/pipeline-schedule-rules";

export {
  DATALEADSELL_DAILY_RUN_TIME_LABEL,
  DATALEADSELL_SCHEDULE_ID,
  GARBAGE_AI_DAILY_RUN_TIME_LABEL,
  GARBAGE_AI_SCHEDULE_ID,
  scheduleSchema,
  VAULT_DAILY_RUN_TIME_LABEL,
  VAULT_SCHEDULE_ID,
  type PipelineScheduleData,
} from "@/lib/pipeline-schedule-rules";

const DEFAULT_SCHEDULE: PipelineScheduleData = { enabled: true, emailsPerDay: 30 };
/**
 * Until someone saves settings for a pipeline, its daily run uses these.
 * dataleadsell starts off, with a small batch, so its volume grows
 * gradually and bounces stay low.
 */
const DEFAULT_SCHEDULES: Record<string, PipelineScheduleData> = {
  [DATALEADSELL_SCHEDULE_ID]: { enabled: false, emailsPerDay: 10 },
};

export async function getPipelineSchedule(pipelineId: string): Promise<PipelineScheduleData> {
  const row = await prisma.pipelineSchedule.findUnique({ where: { id: pipelineId } });
  if (!row) return DEFAULT_SCHEDULES[pipelineId] ?? DEFAULT_SCHEDULE;
  // Older rows may hold up to 100 (the cap before it was tied to Yelp's page size).
  return { enabled: row.enabled, emailsPerDay: Math.min(row.leadCount, EMAILS_PER_DAY_MAX) };
}

export async function savePipelineSchedule(pipelineId: string, data: PipelineScheduleData): Promise<void> {
  const row = { enabled: data.enabled, leadCount: data.emailsPerDay };
  await prisma.pipelineSchedule.upsert({ where: { id: pipelineId }, create: { id: pipelineId, ...row }, update: row });
}
