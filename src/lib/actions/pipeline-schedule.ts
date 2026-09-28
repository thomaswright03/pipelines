"use server";

import { failureMessage } from "@/lib/db-health";
import { revalidatePath } from "next/cache";
import { logError } from "@/lib/log";
import {
  DATALEADSELL_SCHEDULE_ID,
  GARBAGE_AI_SCHEDULE_ID,
  savePipelineSchedule,
  scheduleSchema,
  VAULT_SCHEDULE_ID,
} from "@/lib/pipeline-schedule";
import { AGENTS_PER_RUN_LABEL, HAULERS_PER_RUN_LABEL, scheduleSchemaFor } from "@/lib/pipeline-schedule-rules";

export type UpdateScheduleState = {
  error?: string;
  saved?: boolean;
  values?: { enabled: boolean; businessesPerRun: string };
};

type ScheduleTarget = {
  scheduleId: string;
  schema: typeof scheduleSchema;
  /** The pipeline page that shows the settings. */
  path: string;
  logScope: string;
};

async function updateSchedule(target: ScheduleTarget, formData: FormData): Promise<UpdateScheduleState> {
  const values = {
    enabled: formData.get("enabled") === "on",
    businessesPerRun: String(formData.get("businessesPerRun") ?? ""),
  };
  const parsed = target.schema.safeParse({
    enabled: values.enabled,
    businessesPerRun: values.businessesPerRun.trim() === "" ? Number.NaN : Number(values.businessesPerRun),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message, values };
  }
  try {
    await savePipelineSchedule(target.scheduleId, parsed.data);
  } catch (err) {
    logError(target.logScope, err);
    return { error: failureMessage(err, "Couldn't save the schedule — nothing changed. Try again in a moment."), values };
  }
  revalidatePath(target.path);
  return { saved: true, values };
}

export async function updateVaultScheduleAction(_prevState: UpdateScheduleState, formData: FormData): Promise<UpdateScheduleState> {
  return updateSchedule(
    { scheduleId: VAULT_SCHEDULE_ID, schema: scheduleSchema, path: "/vault-pipeline", logScope: "action.updateVaultSchedule" },
    formData,
  );
}

export async function updateDataleadsellScheduleAction(_prevState: UpdateScheduleState, formData: FormData): Promise<UpdateScheduleState> {
  return updateSchedule(
    {
      scheduleId: DATALEADSELL_SCHEDULE_ID,
      schema: scheduleSchemaFor(AGENTS_PER_RUN_LABEL),
      path: "/dataleadsell",
      logScope: "action.updateDataleadsellSchedule",
    },
    formData,
  );
}

export async function updateGarbageAiScheduleAction(_prevState: UpdateScheduleState, formData: FormData): Promise<UpdateScheduleState> {
  return updateSchedule(
    {
      scheduleId: GARBAGE_AI_SCHEDULE_ID,
      schema: scheduleSchemaFor(HAULERS_PER_RUN_LABEL),
      path: "/garbage-ai",
      logScope: "action.updateGarbageAiSchedule",
    },
    formData,
  );
}
