"use server";

import { failureMessage } from "@/lib/db-health";
import { revalidatePath } from "next/cache";
import { logError } from "@/lib/log";
import { GARBAGE_AI_SCHEDULE_ID, savePipelineSchedule, scheduleSchema, VAULT_SCHEDULE_ID } from "@/lib/pipeline-schedule";

export type UpdateScheduleState = {
  error?: string;
  saved?: boolean;
  values?: { enabled: boolean; businessesPerRun: string };
};

export async function updateVaultScheduleAction(_prevState: UpdateScheduleState, formData: FormData): Promise<UpdateScheduleState> {
  return updateSchedule(VAULT_SCHEDULE_ID, "/vault-pipeline", formData);
}

export async function updateGarbageAiScheduleAction(_prevState: UpdateScheduleState, formData: FormData): Promise<UpdateScheduleState> {
  return updateSchedule(GARBAGE_AI_SCHEDULE_ID, "/garbage-ai", formData);
}

async function updateSchedule(scheduleId: string, path: string, formData: FormData): Promise<UpdateScheduleState> {
  const values = {
    enabled: formData.get("enabled") === "on",
    businessesPerRun: String(formData.get("businessesPerRun") ?? ""),
  };
  const parsed = scheduleSchema.safeParse({
    enabled: values.enabled,
    businessesPerRun: values.businessesPerRun.trim() === "" ? Number.NaN : Number(values.businessesPerRun),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message, values };
  }
  try {
    await savePipelineSchedule(scheduleId, parsed.data);
  } catch (err) {
    logError("action.updateSchedule", err, { scheduleId });
    return { error: failureMessage(err, "Couldn't save the schedule — nothing changed. Try again in a moment."), values };
  }
  revalidatePath(path);
  return { saved: true, values };
}
