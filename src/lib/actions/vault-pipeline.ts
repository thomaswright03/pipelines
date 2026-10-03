"use server";

// Cold Outreach–only server actions. Everything the pipelines share
// (sending, email lookup, status changes, reply/bounce/opt-out) lives in
// ./outreach.ts on top of src/lib/outreach/.
import { failureMessage } from "@/lib/db-health";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/log";
import { normalizePhone } from "@/lib/phone";
import { normalizeState } from "@/lib/us-states";
import { findBusinessesViaYelp, YelpError } from "@/lib/yelp-discovery";
import { pickNextCity, markCityUsed } from "@/lib/vault-city-picker";
import { withRetry } from "@/lib/with-retry";
import { parseZonedInputValue, formatDateTime } from "@/lib/time";
import { APPOINTMENT_FROM, statusLabel } from "@/lib/lead-status";
import {
  coldOutreachLeadSchema,
  coldOutreachLeadEditSchema,
  fieldErrorsOf,
  normalizeWebsite,
  parseMoneyToCents,
  type ColdOutreachLeadInput,
  type FormState,
} from "@/lib/lead-forms";
import { createLeadsFromCandidates, describeDiscovery, routeToPhoneOutreach } from "@/lib/outreach/discovery";
import { checkAddressForLead, editLead } from "@/lib/outreach/lead-edit";
import { enteredByHandEvidence } from "@/lib/outreach/evidence";
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
const CHANGED_MEANWHILE = (name: string) =>
  `${name} changed status a moment ago (a reply or an automatic move) — reload the page to see it, then try again.`;

// --- Manual entry and editing ---

type LeadFormState = FormState<ColdOutreachLeadInput> & { leadId?: string };

function coldOutreachColumns(d: ColdOutreachLeadInput & { name: string }) {
  return {
    name: d.name,
    company: d.company || null,
    phone: normalizePhone(d.phone),
    address: d.address || null,
    city: d.city || null,
    state: normalizeState(d.state ?? ""),
    website: normalizeWebsite(d.website ?? ""),
    source: d.source || "Manual entry",
    estimatedValueCents: d.estimatedValue ? parseMoneyToCents(d.estimatedValue) : null,
    notes: d.notes || null,
  };
}

export async function createLeadAction(input: ColdOutreachLeadInput): Promise<LeadFormState> {
  const parsed = coldOutreachLeadSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Fix the highlighted fields.", fieldErrors: fieldErrorsOf<ColdOutreachLeadInput>(parsed.error) };
  }
  const d = parsed.data;
  const email = d.email ? d.email.toLowerCase() : null;

  try {
    if (email) {
      const problem = await checkAddressForLead("cold-outreach", email);
      if (problem) {
        return {
          error: "This email can't be used.",
          fieldErrors: { email: problem.message },
          ...(problem.link ? { fieldLinks: { email: problem.link } } : {}),
        };
      }
    }
    const lead = await prisma.lead.create({
      data: { ...coldOutreachColumns(d), email, emailEvidence: email ? enteredByHandEvidence() : null },
    });
    revalidate();
    return { ok: true, leadId: lead.id };
  } catch (err) {
    logError("action.createLead", err);
    return { error: failureMessage(err, UNEXPECTED) };
  }
}

export async function updateLeadAction(leadId: string, input: ColdOutreachLeadInput): Promise<LeadFormState> {
  const existing = await prisma.lead.findUnique({ where: { id: leadId }, select: { notes: true } }).catch(() => null);
  const parsed = coldOutreachLeadEditSchema(existing?.notes).safeParse(input);
  if (!parsed.success) {
    return { error: "Fix the highlighted fields.", fieldErrors: fieldErrorsOf<ColdOutreachLeadInput>(parsed.error) };
  }
  const d = parsed.data;
  try {
    const outcome = await editLead("cold-outreach", leadId, d.email || null, coldOutreachColumns(d));
    if (!outcome.ok) {
      if (outcome.field !== "email") return { error: outcome.error };
      return {
        error: "This email can't be used.",
        fieldErrors: { email: outcome.error },
        ...(outcome.link ? { fieldLinks: { email: outcome.link } } : {}),
      };
    }
    revalidate(leadId);
    return { ok: true, leadId };
  } catch (err) {
    logError("action.updateLead", err, { leadId });
    return { error: failureMessage(err, UNEXPECTED) };
  }
}

// --- Discovery ---

export type LeadSearchState = { error?: string; message?: string };

// Every lookup ends by this long after the click (one in flight is cut
// off), which leaves room under the 60 s function limit for saving and the
// response. The Yelp call (≤10 s) is inside this budget.
const RUN_TIME_BUDGET_MS = 45 * 1000;
const MAX_PER_RUN = 50;

const searchSchema = z.object({
  city: z.string().trim().min(1, "Enter a city").max(80, "City can be at most 80 characters"),
  state: z
    .string()
    .trim()
    .refine((v) => normalizeState(v) !== null, "State must be a US state, like UT or Utah"),
  businessType: z.string().trim().max(80, "Business type can be at most 80 characters"),
});

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
    return { message: describeDiscovery("cold-outreach", `${parsed.data.city}, ${state}`, results.length, result) };
  } catch (err) {
    if (err instanceof YelpError) return { error: err.message };
    logError("action.searchLeads", err);
    return { error: failureMessage(err, "The search stopped because of an unexpected error. Any leads already added are saved.") };
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
    return { ok: true, message: describeDiscovery("cold-outreach", `${target.city}, ${target.state}`, results.length, result) };
  } catch (err) {
    if (err instanceof YelpError) return { ok: false, error: err.message };
    logError("action.runPipelineScrape", err);
    return { ok: false, error: failureMessage(err, "The run stopped because of an unexpected error. Any leads already added are saved.") };
  }
}

// --- Pipeline stage (Cold Outreach only) ---

export async function scheduleAppointmentAction(leadId: string, localDateTime: string): Promise<ActionResult> {
  const date = parseZonedInputValue(String(localDateTime ?? ""));
  if (!date) return { ok: false, error: "Pick a date and time for the appointment." };
  try {
    const lead = await pipeline.findLead(prisma, leadId);
    if (!lead) return { ok: false, error: "This lead no longer exists." };
    if (!APPOINTMENT_FROM.includes(lead.status)) {
      return { ok: false, error: `An appointment can't be set for a ${statusLabel(lead.status)} lead.` };
    }
    const { count } = await prisma.lead.updateMany({
      where: { id: leadId, status: lead.status },
      data: { appointmentAt: date, status: "appointment_set" },
    });
    if (count === 0) return { ok: false, error: CHANGED_MEANWHILE(lead.name) };
    revalidate(leadId);
    return { ok: true, message: `Appointment with ${lead.name} set for ${formatDateTime(date)} — moved to Appointment set.` };
  } catch (err) {
    logError("action.scheduleAppointment", err, { leadId });
    return { ok: false, error: failureMessage(err, UNEXPECTED) };
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
    return {
      ok: true,
      message: status
        ? `Recorded the bounce for ${lead.name} — moved to ${statusLabel(status)}.`
        : `Recorded the bounce for ${lead.name}. Their status changed meanwhile, so it was left as it is.`,
    };
  } catch (err) {
    logError("action.markResponseAsNonDelivery", err, { leadId });
    return { ok: false, error: failureMessage(err, UNEXPECTED) };
  }
}
