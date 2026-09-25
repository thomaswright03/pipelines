"use server";

// Cold Outreach–only server actions. Everything both pipelines share
// (sending, email lookup, status changes, reply/bounce/opt-out) lives in
// ./outreach.ts on top of src/lib/outreach/.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/log";
import { normalizePhone } from "@/lib/phone";
import { normalizeState } from "@/lib/us-states";
import { revealLatestMessageInMailApp, canUseMailApp } from "@/lib/mail-app";
import { findBusinessesViaYelp, YelpError } from "@/lib/yelp-discovery";
import { pickNextCity, markCityUsed } from "@/lib/vault-city-picker";
import { withRetry } from "@/lib/with-retry";
import { VAULT_PIPELINE_SENDER_EMAIL } from "@/lib/vault-config";
import { parseZonedInputValue, formatDateTime } from "@/lib/time";
import { statusLabel, CALL_OUTCOME_LABEL } from "@/lib/lead-status";
import {
  coldOutreachLeadSchema,
  fieldErrorsOf,
  normalizeWebsite,
  parseMoney,
  type ColdOutreachLeadInput,
  type FormState,
} from "@/lib/lead-forms";
import { createLeadsFromCandidates, describeAddressConflict, routeToPhoneOutreach } from "@/lib/outreach/discovery";
import { getPipeline } from "@/lib/outreach/pipelines";
import type { ActionResult } from "@/lib/outreach/lead-actions";

const BASE_PATH = "/vault-pipeline";
const pipeline = getPipeline("cold-outreach");

function revalidate(leadId?: string) {
  revalidatePath(BASE_PATH);
  revalidatePath(`${BASE_PATH}/stats`);
  if (leadId) revalidatePath(`${BASE_PATH}/${leadId}`);
}

const UNEXPECTED = "Something went wrong saving that — nothing was changed. Try again in a moment.";

// --- Manual entry ---

export type LeadFormState = FormState<ColdOutreachLeadInput> & { leadId?: string };

export async function createLeadAction(input: ColdOutreachLeadInput): Promise<LeadFormState> {
  const parsed = coldOutreachLeadSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Fix the highlighted fields.", fieldErrors: fieldErrorsOf<ColdOutreachLeadInput>(parsed.error) };
  }
  const d = parsed.data;
  const email = d.email ? d.email.toLowerCase() : null;

  try {
    if (email) {
      const conflict = await describeAddressConflict("cold-outreach", email);
      if (conflict) {
        return {
          error: "This email is already in use.",
          fieldErrors: { email: `${conflict} — each address gets one pitch. Edit that lead instead.` },
        };
      }
    }
    const lead = await prisma.lead.create({
      data: {
        name: d.name,
        company: d.company || null,
        email,
        phone: normalizePhone(d.phone),
        address: d.address || null,
        city: d.city || null,
        state: normalizeState(d.state),
        website: normalizeWebsite(d.website),
        source: d.source || "Manual entry",
        estimatedValue: d.estimatedValue ? parseMoney(d.estimatedValue) : null,
        notes: d.notes || null,
      },
    });
    revalidate();
    return { ok: true, leadId: lead.id };
  } catch (err) {
    logError("action.createLead", err);
    return { error: UNEXPECTED };
  }
}

// --- Discovery ---

export type LeadSearchState = { error?: string; message?: string };

// Leaves room under the 60 s function limit for the Yelp call (≤10 s) and
// the last lookup in flight (≤15 s).
const RUN_TIME_BUDGET_MS = 25 * 1000;
const MAX_PER_RUN = 50;

const searchSchema = z.object({
  city: z.string().trim().min(1, "Enter a city").max(80, "City can be at most 80 characters"),
  state: z
    .string()
    .trim()
    .refine((v) => normalizeState(v) !== null, "State must be a US state, like UT or Utah"),
  businessType: z.string().trim().max(80, "Business type can be at most 80 characters"),
});

function describeDiscovery(where: string, scraped: number, result: Awaited<ReturnType<typeof createLeadsFromCandidates>>) {
  const skipped: string[] = [];
  if (result.skipped.existingName) skipped.push(`${result.skipped.existingName} already in the list`);
  if (result.skipped.noEmail) skipped.push(`${result.skipped.noEmail} with no findable email`);
  if (result.skipped.addressInUse) skipped.push(`${result.skipped.addressInUse} whose email is already in use`);
  if (result.skipped.optedOut) skipped.push(`${result.skipped.optedOut} opted out`);
  return (
    `Found ${scraped} businesses in ${where} and added ${result.created.length} new lead${result.created.length === 1 ? "" : "s"}` +
    (skipped.length ? ` (skipped ${skipped.join(", ")})` : "") +
    (result.stoppedEarly ? ". Stopped early to stay within the time limit — run again for more." : ".")
  );
}

export async function searchLeadsAction(_prev: LeadSearchState, formData: FormData): Promise<LeadSearchState> {
  const parsed = searchSchema.safeParse({
    city: String(formData.get("city") ?? ""),
    state: String(formData.get("state") ?? ""),
    businessType: String(formData.get("businessType") ?? ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the search fields." };
  const state = normalizeState(parsed.data.state)!;
  const startedAt = Date.now();

  try {
    const results = await findBusinessesViaYelp(parsed.data.businessType, `${parsed.data.city}, ${state}`);
    if (results.length === 0) return { error: `Yelp found no businesses in ${parsed.data.city}, ${state}.` };
    const result = await createLeadsFromCandidates("cold-outreach", results, {
      city: parsed.data.city,
      state,
      source: "Yelp search",
      maxCreate: MAX_PER_RUN,
      deadline: startedAt + RUN_TIME_BUDGET_MS,
    });
    revalidate();
    return { message: describeDiscovery(`${parsed.data.city}, ${state}`, results.length, result) };
  } catch (err) {
    if (err instanceof YelpError) return { error: err.message };
    logError("action.searchLeads", err);
    return { error: "The search stopped because of an unexpected error. Any leads already added are saved." };
  }
}

export async function runPipelineScrapeAction(): Promise<ActionResult> {
  const startedAt = Date.now();
  try {
    const target = await withRetry(() => pickNextCity(prisma));
    const results = await findBusinessesViaYelp("", `${target.city}, ${target.state}`);
    await withRetry(() => markCityUsed(prisma, target.city, target.state));
    const result = await createLeadsFromCandidates("cold-outreach", results, {
      city: target.city,
      state: target.state,
      source: "Yelp search (Run pipeline button)",
      maxCreate: MAX_PER_RUN,
      deadline: startedAt + RUN_TIME_BUDGET_MS,
    });
    revalidate();
    return { ok: true, message: describeDiscovery(`${target.city}, ${target.state}`, results.length, result) };
  } catch (err) {
    if (err instanceof YelpError) return { ok: false, error: err.message };
    logError("action.runPipelineScrape", err);
    return { ok: false, error: "The run stopped because of an unexpected error. Any leads already added are saved." };
  }
}

// --- Pipeline stage (Cold Outreach only) ---

const APPOINTMENT_FROM = ["contacted", "responded", "cold_call_list", "appointment_set"];

export async function scheduleAppointmentAction(leadId: string, localDateTime: string): Promise<ActionResult> {
  const date = parseZonedInputValue(String(localDateTime ?? ""));
  if (!date) return { ok: false, error: "Pick a date and time for the appointment." };
  try {
    const lead = await pipeline.findLead(prisma, leadId);
    if (!lead) return { ok: false, error: "This lead no longer exists." };
    if (!APPOINTMENT_FROM.includes(lead.status)) {
      return { ok: false, error: `An appointment can't be set for a ${statusLabel(lead.status)} lead.` };
    }
    await prisma.lead.update({ where: { id: leadId }, data: { appointmentAt: date, status: "appointment_set" } });
    revalidate(leadId);
    return { ok: true, message: `Appointment with ${lead.name} set for ${formatDateTime(date)} — moved to Appointment set.` };
  } catch (err) {
    logError("action.scheduleAppointment", err, { leadId });
    return { ok: false, error: UNEXPECTED };
  }
}

const LOST_REASONS = ["not_interested", "too_busy", "no_answer", "no_need", "unable_to_contact"] as const;

export async function markLeadLostAction(leadId: string, reason: string): Promise<ActionResult> {
  if (!(LOST_REASONS as readonly string[]).includes(reason)) return { ok: false, error: "Pick a reason first." };
  try {
    const lead = await pipeline.findLead(prisma, leadId);
    if (!lead) return { ok: false, error: "This lead no longer exists." };
    if (lead.status === "lost") return { ok: false, error: `${lead.name} is already Lost.` };
    await prisma.lead.update({ where: { id: leadId }, data: { status: "lost", callOutcome: reason } });
    revalidate(leadId);
    return { ok: true, message: `Marked ${lead.name} as Lost (${CALL_OUTCOME_LABEL[reason] ?? reason}).` };
  } catch (err) {
    logError("action.markLeadLost", err, { leadId });
    return { ok: false, error: UNEXPECTED };
  }
}

// Corrects a "Mark replied" that was really a non-delivery notice: the
// latest send is marked bounced, the reply timestamps are cleared, and the
// lead goes to phone outreach.
export async function markResponseAsNonDeliveryAction(leadId: string): Promise<ActionResult> {
  try {
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) return { ok: false, error: "This lead no longer exists." };
    if (!lead.repliedAt || lead.status !== "responded") {
      return { ok: false, error: `${lead.name} isn't marked as replied, so there's nothing to correct.` };
    }
    await pipeline.markLatestSendBounced(prisma, leadId, lead.repliedAt);
    await prisma.lead.update({ where: { id: leadId }, data: { repliedAt: null, ourReplyAt: null } });
    const status = await routeToPhoneOutreach("cold-outreach", lead);
    revalidate(leadId);
    return { ok: true, message: `Recorded the bounce for ${lead.name} — moved to the ${statusLabel(status)}.` };
  } catch (err) {
    logError("action.markResponseAsNonDelivery", err, { leadId });
    return { ok: false, error: UNEXPECTED };
  }
}

export async function viewLeadEmailThreadAction(leadId: string): Promise<ActionResult> {
  if (!canUseMailApp()) {
    return { ok: false, error: "Opening Mail only works when the app runs on your Mac, not on the deployed site." };
  }
  try {
    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { email: true, name: true } });
    if (!lead?.email) return { ok: false, error: "This lead has no email address." };
    const found = await revealLatestMessageInMailApp(VAULT_PIPELINE_SENDER_EMAIL, lead.email);
    return found
      ? { ok: true, message: `Opened the latest message from ${lead.name} in Mail.` }
      : { ok: false, error: `No message from ${lead.email} was found in Mail.` };
  } catch (err) {
    logError("action.viewLeadEmailThread", err, { leadId });
    return { ok: false, error: "Mail couldn't be opened — is Mail.app set up with the sending account?" };
  }
}

// --- Activity log ---

const ACTIVITY_TYPES = ["note", "call", "email", "meeting"] as const;

export async function addLeadActivityAction(leadId: string, type: string, notes: string): Promise<ActionResult> {
  const trimmed = String(notes ?? "").trim();
  if (!trimmed) return { ok: false, error: "Write what happened first." };
  if (trimmed.length > 2_000) return { ok: false, error: "Keep an activity note under 2,000 characters." };
  if (!(ACTIVITY_TYPES as readonly string[]).includes(type)) return { ok: false, error: "Pick an activity type." };
  try {
    await prisma.leadActivity.create({ data: { leadId, type, notes: trimmed } });
    revalidate(leadId);
    return { ok: true, message: "Activity added." };
  } catch (err) {
    logError("action.addLeadActivity", err, { leadId });
    return { ok: false, error: UNEXPECTED };
  }
}
