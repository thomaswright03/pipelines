"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";

export type PipelineScheduleData = {
  enabled: boolean;
  hour: number;
  minute: number;
  leadCount: number;
};

const DEFAULT_SCHEDULE: PipelineScheduleData = { enabled: true, hour: 8, minute: 33, leadCount: 30 };

export async function getPipelineSchedule(pipelineId: string): Promise<PipelineScheduleData> {
  const row = await prisma.pipelineSchedule.findUnique({ where: { id: pipelineId } });
  if (!row) return DEFAULT_SCHEDULE;
  return { enabled: row.enabled, hour: row.hour, minute: row.minute, leadCount: row.leadCount };
}

const scheduleSchema = z.object({
  enabled: z.boolean(),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  leadCount: z.number().int().min(1).max(100),
});

export type UpdateScheduleState = { error?: string; saved?: boolean };

export async function updatePipelineScheduleAction(
  pipelineId: string,
  revalidatePathName: string,
  _prevState: UpdateScheduleState,
  formData: FormData,
): Promise<UpdateScheduleState> {
  const parsed = scheduleSchema.safeParse({
    enabled: formData.get("enabled") === "on",
    hour: Number(formData.get("hour")),
    minute: Number(formData.get("minute")),
    leadCount: Number(formData.get("leadCount")),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid schedule" };
  }

  await prisma.pipelineSchedule.upsert({
    where: { id: pipelineId },
    create: { id: pipelineId, ...parsed.data },
    update: parsed.data,
  });

  revalidatePath(revalidatePathName);
  return { saved: true };
}
