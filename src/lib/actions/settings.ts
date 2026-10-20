"use server";

import { failureMessage } from "@/lib/db-health";
import { ENV_OFF_DETAIL, outboundDisabledByEnvironment } from "@/lib/outbound-switch";
import { revalidatePath } from "next/cache";
import { logError } from "@/lib/log";
import { recordServiceCheck, setAllowCrossPipelineRepeats, setOutboundPaused } from "@/lib/outreach/settings";
import { describeConnectionTestError, verifyMailTransport } from "@/lib/send-email";
import { findBusinessesViaYelp, YelpError } from "@/lib/yelp-discovery";
import { formatDateTime } from "@/lib/time";
import { addSuppression, removeSuppressionByEmail, type ActionResult } from "@/lib/outreach/lead-actions";
import { startReplyCheck } from "@/lib/outreach/reply-check";

export async function setOutboundPausedAction(paused: boolean): Promise<ActionResult> {
  try {
    await setOutboundPaused(Boolean(paused));
    // The header pill on every page shows this state.
    revalidatePath("/", "layout");
    return {
      ok: true,
      message: paused
        ? "Outbound email is paused. Nothing will be sent — manual, bulk or automated — until you resume."
        : outboundDisabledByEnvironment()
          ? `The pause switch is off, but sending is still switched off by whoever manages the app's hosting, so nothing is sent until they turn it back on. (${ENV_OFF_DETAIL})`
          : "Outbound email resumed.",
    };
  } catch (err) {
    logError("action.setOutboundPaused", err, { paused });
    return { ok: false, error: failureMessage(err, "Couldn't save that — the setting didn't change. Try again in a moment.") };
  }
}

export async function setAllowCrossPipelineRepeatsAction(allow: boolean): Promise<ActionResult> {
  try {
    await setAllowCrossPipelineRepeats(Boolean(allow));
    revalidatePath("/settings");
    return {
      ok: true,
      message: allow
        ? "An address pitched by one pipeline can now also be pitched by each of the others (still once per pipeline)."
        : "Each address now gets at most one pitch across all pipelines.",
    };
  } catch (err) {
    logError("action.setAllowCrossPipelineRepeats", err, { allow });
    return { ok: false, error: failureMessage(err, "Couldn't save that — the setting didn't change. Try again in a moment.") };
  }
}

function refreshLists() {
  revalidatePath("/settings");
  revalidatePath("/vault-pipeline", "layout");
  revalidatePath("/garbage-ai", "layout");
  revalidatePath("/room-designer", "layout");
  revalidatePath("/dataleadsell", "layout");
}

export async function addSuppressionAction(email: string, note: string): Promise<ActionResult> {
  try {
    const result = await addSuppression(String(email ?? ""), String(note ?? ""));
    refreshLists();
    return result;
  } catch (err) {
    logError("action.addSuppression", err);
    return { ok: false, error: failureMessage(err, "Couldn't save that — the list didn't change. Try again in a moment.") };
  }
}

export async function removeSuppressionByEmailAction(email: string): Promise<ActionResult> {
  try {
    const result = await removeSuppressionByEmail(String(email ?? ""));
    refreshLists();
    return result;
  } catch (err) {
    logError("action.removeSuppressionByEmail", err);
    return { ok: false, error: failureMessage(err, "Couldn't save that — the list didn't change. Try again in a moment.") };
  }
}

/**
 * Settings → Connections "Test connection": proves the credentials work
 * without sending an email or using up more than one Yelp search.
 * - mail: SMTP connect, STARTTLS and login, then disconnect.
 * - yelp: one search for a single business.
 * The result is remembered and shown in the Connections list.
 */
export async function testConnectionAction(service: "mail" | "yelp"): Promise<ActionResult> {
  const at = new Date();
  if (service === "mail") {
    try {
      await verifyMailTransport();
      await recordServiceCheck("mail", null, at);
      revalidatePath("/settings");
      return { ok: true, message: `Email service: connected and logged in at ${formatDateTime(at)}. No email was sent.` };
    } catch (err) {
      logError("action.testConnection.mail", err);
      const message = describeConnectionTestError(err);
      await recordServiceCheck("mail", message, at);
      revalidatePath("/settings");
      return { ok: false, error: `Email service: ${message}` };
    }
  }
  if (service === "yelp") {
    try {
      // findBusinessesViaYelp remembers the outcome itself.
      await findBusinessesViaYelp("", "Phoenix, AZ", { limit: 1 });
      revalidatePath("/settings");
      return { ok: true, message: `Yelp: answered a test search at ${formatDateTime(at)}.` };
    } catch (err) {
      if (!(err instanceof YelpError)) logError("action.testConnection.yelp", err);
      revalidatePath("/settings");
      return {
        ok: false,
        error: `Yelp: ${err instanceof YelpError ? err.message : "the test search failed. Try again later; if it keeps failing, tell your developer."}`,
      };
    }
  }
  return { ok: false, error: "Unknown service." };
}

/**
 * Settings → Connections "Check the reply loop": sends the real Cold
 * Outreach pitch to an address the operator controls (reply-check.ts).
 */
export async function startReplyCheckAction(email: string): Promise<ActionResult> {
  try {
    const result = await startReplyCheck(String(email ?? ""));
    revalidatePath("/settings");
    revalidatePath("/vault-pipeline", "layout");
    return result.ok ? { ok: true, message: result.message } : { ok: false, error: result.error };
  } catch (err) {
    logError("action.startReplyCheck", err);
    return {
      ok: false,
      error: failureMessage(err, "Something went wrong — check Cold Outreach before trying again, in case the pitch went out."),
    };
  }
}
