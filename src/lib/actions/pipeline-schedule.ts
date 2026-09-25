"use server";

import { revalidatePath } from "next/cache";
import { logError } from "@/lib/log";
import { savePipelineSchedule, scheduleSchema, VAULT_SCHEDULE_ID } from "@/lib/pipeline-schedule";

export type UpdateScheduleState = {
  error?: string;
  saved?: boolean;
  values?: { enabled: boolean; businessesPerRun: string };
};

export async function updateVaultScheduleAction(_prevState: UpdateScheduleState, formData: FormData): Promise<UpdateScheduleState> {
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
    await savePipelineSchedule(VAULT_SCHEDULE_ID, parsed.data);
  } catch (err) {
    logError("action.updateVaultSchedule", err);
    return { error: "Couldn't save the schedule — nothing changed. Try again in a moment.", values };
  }
  revalidatePath("/vault-pipeline");
  return { saved: true, values };
}
