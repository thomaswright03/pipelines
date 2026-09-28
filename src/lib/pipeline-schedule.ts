// Daily-automation settings (see PipelineSchedule in schema.prisma). The
// fire time is fixed in vercel.json; only "enabled" and "businesses to
// check per run" are live settings. Validation rules: ./pipeline-schedule-rules.ts.
import { prisma } from "@/lib/db";
import { BUSINESSES_PER_RUN_MAX, DATALEADSELL_SCHEDULE_ID, type PipelineScheduleData } from "@/lib/pipeline-schedule-rules";

export {
  DATALEADSELL_DAILY_RUN_TIME_LABEL,
  DATALEADSELL_SCHEDULE_ID,
  scheduleSchema,
  VAULT_DAILY_RUN_TIME_LABEL,
  VAULT_SCHEDULE_ID,
  type PipelineScheduleData,
} from "@/lib/pipeline-schedule-rules";

const DEFAULT_SCHEDULE: PipelineScheduleData = { enabled: true, businessesPerRun: 30 };
/**
 * Until someone saves settings for a pipeline, its daily run uses these.
 * dataleadsell starts off, with a small batch: its sending domain is new
 * and has to be warmed up before it sends at volume.
 */
const DEFAULT_SCHEDULES: Record<string, PipelineScheduleData> = {
  [DATALEADSELL_SCHEDULE_ID]: { enabled: false, businessesPerRun: 10 },
};

export async function getPipelineSchedule(pipelineId: string): Promise<PipelineScheduleData> {
  const row = await prisma.pipelineSchedule.findUnique({ where: { id: pipelineId } });
  if (!row) return DEFAULT_SCHEDULES[pipelineId] ?? DEFAULT_SCHEDULE;
  // Older rows may hold up to 100 (the cap before it was tied to Yelp's page size).
  return { enabled: row.enabled, businessesPerRun: Math.min(row.leadCount, BUSINESSES_PER_RUN_MAX) };
}

export async function savePipelineSchedule(pipelineId: string, data: PipelineScheduleData): Promise<void> {
  const row = { enabled: data.enabled, leadCount: data.businessesPerRun };
  await prisma.pipelineSchedule.upsert({ where: { id: pipelineId }, create: { id: pipelineId, ...row }, update: row });
}
