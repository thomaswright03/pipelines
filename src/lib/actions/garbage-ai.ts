"use server";

// Garbage AI–only server actions: adding and editing a hauler by hand, and
// the two "find haulers" buttons. Everything the pipelines share (sending,
// email lookup, status changes, reply/bounce/opt-out) lives in ./outreach.ts.
import { failureMessage } from "@/lib/db-health";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/log";
import { normalizePhone } from "@/lib/phone";
import { normalizeState } from "@/lib/us-states";
import { YelpError } from "@/lib/yelp-discovery";
import { markHaulerCityUsed, pickNextHaulerCity } from "@/lib/garbage-ai-city-picker";
import { isMountainHighCity } from "@/lib/garbage-ai-targeting";
import { describeHaulerSearch, searchHaulers } from "@/lib/garbage-ai-daily-run";
import { withRetry } from "@/lib/with-retry";
import {
  coldOutreachLeadEditSchema,
  coldOutreachLeadSchema,
  fieldErrorsOf,
  normalizeWebsite,
  parseMoneyToCents,
  type ColdOutreachLeadInput,
  type FormState,
} from "@/lib/lead-forms";
import { checkAddressForLead, editLead } from "@/lib/outreach/lead-edit";
import { enteredByHandEvidence } from "@/lib/outreach/evidence";
import type { ActionResult } from "@/lib/outreach/lead-actions";

const BASE_PATH = "/garbage-ai";

function revalidate(leadId?: string) {
  revalidatePath(BASE_PATH);
  revalidatePath(`${BASE_PATH}/stats`);
  if (leadId) revalidatePath(`${BASE_PATH}/${leadId}`);
}

const UNEXPECTED = "Something went wrong saving that — nothing was changed. Try again in a moment.";

// --- Manual entry and editing (same fields and rules as Cold Outreach) ---

type LeadFormState = FormState<ColdOutreachLeadInput> & { leadId?: string };

function haulerColumns(d: ColdOutreachLeadInput & { name: string }) {
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

export async function createHaulerAction(input: ColdOutreachLeadInput): Promise<LeadFormState> {
  const parsed = coldOutreachLeadSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Fix the highlighted fields.", fieldErrors: fieldErrorsOf<ColdOutreachLeadInput>(parsed.error) };
  }
  const d = parsed.data;
  const email = d.email ? d.email.toLowerCase() : null;
  try {
    if (email) {
      const problem = await checkAddressForLead("garbage-ai", email);
      if (problem) {
        return {
          error: "This email can't be used.",
          fieldErrors: { email: problem.message },
          ...(problem.link ? { fieldLinks: { email: problem.link } } : {}),
        };
      }
    }
    const lead = await prisma.haulerLead.create({
      data: { ...haulerColumns(d), email, emailEvidence: email ? enteredByHandEvidence() : null },
    });
    revalidate();
    return { ok: true, leadId: lead.id };
  } catch (err) {
    logError("action.createHauler", err);
    return { error: failureMessage(err, UNEXPECTED) };
  }
}

export async function updateHaulerAction(leadId: string, input: ColdOutreachLeadInput): Promise<LeadFormState> {
  const existing = await prisma.haulerLead.findUnique({ where: { id: leadId }, select: { notes: true } }).catch(() => null);
  const parsed = coldOutreachLeadEditSchema(existing?.notes).safeParse(input);
  if (!parsed.success) {
    return { error: "Fix the highlighted fields.", fieldErrors: fieldErrorsOf<ColdOutreachLeadInput>(parsed.error) };
  }
  const d = parsed.data;
  try {
    const outcome = await editLead("garbage-ai", leadId, d.email || null, haulerColumns(d));
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
    logError("action.updateHauler", err, { leadId });
    return { error: failureMessage(err, UNEXPECTED) };
  }
}

// --- Discovery ---

type HaulerSearchState = { error?: string; message?: string };

// See vault-pipeline.ts: every lookup ends 45 s after the click.
const RUN_TIME_BUDGET_MS = 45 * 1000;
const MAX_PER_RUN = 50;

const searchSchema = z.object({
  city: z.string().trim().min(1, "Enter a city").max(80, "City can be at most 80 characters"),
  state: z
    .string()
    .trim()
    .refine((v) => normalizeState(v) !== null, "State must be a US state, like UT or Utah"),
});

export async function searchHaulersAction(_prev: HaulerSearchState, formData: FormData): Promise<HaulerSearchState> {
  const parsed = searchSchema.safeParse({ city: String(formData.get("city") ?? ""), state: String(formData.get("state") ?? "") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the search fields." };
  const state = normalizeState(parsed.data.state)!;
  const city = parsed.data.city;
  if (isMountainHighCity(city, state)) {
    return { error: `${city}, ${state} is in Mountain High Disposal's service area, so Garbage AI doesn't search there.` };
  }
  try {
    const outcome = await searchHaulers(city, state, {
      source: "Yelp search",
      maxCreate: MAX_PER_RUN,
      deadline: Date.now() + RUN_TIME_BUDGET_MS,
    });
    revalidate();
    if (outcome.listed === 0) return { error: `Yelp found no garbage collection businesses in ${city}, ${state}.` };
    return { message: describeHaulerSearch(`${city}, ${state}`, outcome) };
  } catch (err) {
    if (err instanceof YelpError) return { error: err.message };
    logError("action.searchHaulers", err);
    return { error: failureMessage(err, "The search stopped because of an unexpected error. Any haulers already added are saved.") };
  }
}

export async function runHaulerScrapeAction(): Promise<ActionResult> {
  const startedAt = Date.now();
  try {
    const target = await withRetry(() => pickNextHaulerCity(prisma));
    const outcome = await searchHaulers(target.city, target.state, {
      source: "Yelp search (Find haulers button)",
      maxCreate: MAX_PER_RUN,
      deadline: startedAt + RUN_TIME_BUDGET_MS,
    });
    await withRetry(() => markHaulerCityUsed(prisma, target.city, target.state));
    revalidate();
    return { ok: true, message: describeHaulerSearch(`${target.city}, ${target.state}`, outcome) };
  } catch (err) {
    if (err instanceof YelpError) return { ok: false, error: err.message };
    logError("action.runHaulerScrape", err);
    return {
      ok: false,
      error: failureMessage(err, "The run stopped because of an unexpected error. Any haulers already added are saved."),
    };
  }
}
