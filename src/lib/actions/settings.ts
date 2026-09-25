"use server";

import { revalidatePath } from "next/cache";
import { logError } from "@/lib/log";
import { setAllowCrossPipelineRepeats, setOutboundPaused } from "@/lib/outreach/settings";
import type { ActionResult } from "@/lib/outreach/lead-actions";

export async function setOutboundPausedAction(paused: boolean): Promise<ActionResult> {
  try {
    await setOutboundPaused(Boolean(paused));
    // The header pill on every page shows this state.
    revalidatePath("/", "layout");
    return {
      ok: true,
      message: paused
        ? "Outbound email is paused. Nothing will be sent — manual, bulk or automated — until you resume."
        : "Outbound email resumed.",
    };
  } catch (err) {
    logError("action.setOutboundPaused", err, { paused });
    return { ok: false, error: "Couldn't save that — the setting didn't change. Try again in a moment." };
  }
}

export async function setAllowCrossPipelineRepeatsAction(allow: boolean): Promise<ActionResult> {
  try {
    await setAllowCrossPipelineRepeats(Boolean(allow));
    revalidatePath("/settings");
    return {
      ok: true,
      message: allow
        ? "An address pitched by one pipeline can now also be pitched by the other (still once per pipeline)."
        : "Each address now gets at most one pitch across both pipelines.",
    };
  } catch (err) {
    logError("action.setAllowCrossPipelineRepeats", err, { allow });
    return { ok: false, error: "Couldn't save that — the setting didn't change. Try again in a moment." };
  }
}
