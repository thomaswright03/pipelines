"use server";

// Room Designer 3D–only server actions: adding and editing a remodeler by hand, and
// the two "find remodelers" buttons. Everything the pipelines share (sending,
// email lookup, status changes, reply/bounce/opt-out) lives in ./outreach.ts.
import { failureMessage } from "@/lib/db-health";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/log";
import { normalizeState } from "@/lib/us-states";
import { YelpError } from "@/lib/yelp-discovery";
import { markRemodelerCityUsed, pickNextRemodelerCity } from "@/lib/room-designer-city-picker";
import { describeRemodelerSearch, searchRemodelers } from "@/lib/room-designer-daily-run";
import { withRetry } from "@/lib/with-retry";
import { coldOutreachLeadEditSchema, coldOutreachLeadSchema, type ColdOutreachLeadInput } from "@/lib/lead-forms";
import type { Prisma } from "@/generated/prisma/client";
import {
  businessLeadColumns,
  createManualLead,
  updateManualLead,
  type LeadFormState,
  type ManualLeadSpec,
} from "@/lib/outreach/manual-lead";
import type { ActionResult } from "@/lib/outreach/lead-actions";

const BASE_PATH = "/room-designer";

function revalidate(leadId?: string) {
  revalidatePath(BASE_PATH);
  revalidatePath(`${BASE_PATH}/stats`);
  if (leadId) revalidatePath(`${BASE_PATH}/${leadId}`);
}

// --- Manual entry and editing (same fields as Cold Outreach; shared flow: outreach/manual-lead.ts) ---

const manualLead: ManualLeadSpec<ColdOutreachLeadInput, ColdOutreachLeadInput & { name: string }> = {
  pipeline: "room-designer",
  createSchema: coldOutreachLeadSchema,
  editSchema: coldOutreachLeadEditSchema,
  columns: businessLeadColumns,
  insert: (db, data) => db.remodelerLead.create({ data: data as Prisma.RemodelerLeadUncheckedCreateInput }),
  currentNotes: async (db, id) => (await db.remodelerLead.findUnique({ where: { id }, select: { notes: true } }))?.notes,
  logScopes: { create: "action.createRemodeler", update: "action.updateRemodeler" },
};

export async function createRemodelerAction(input: ColdOutreachLeadInput): Promise<LeadFormState<ColdOutreachLeadInput>> {
  return createManualLead(manualLead, input);
}

export async function updateRemodelerAction(leadId: string, input: ColdOutreachLeadInput): Promise<LeadFormState<ColdOutreachLeadInput>> {
  return updateManualLead(manualLead, leadId, input);
}

// --- Discovery ---

type RemodelerSearchState = { error?: string; message?: string };

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

export async function searchRemodelersAction(_prev: RemodelerSearchState, formData: FormData): Promise<RemodelerSearchState> {
  const parsed = searchSchema.safeParse({ city: String(formData.get("city") ?? ""), state: String(formData.get("state") ?? "") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the search fields." };
  const state = normalizeState(parsed.data.state)!;
  const city = parsed.data.city;
  try {
    const outcome = await searchRemodelers(city, state, {
      source: "Yelp search",
      maxCreate: MAX_PER_RUN,
      deadline: Date.now() + RUN_TIME_BUDGET_MS,
    });
    revalidate();
    if (outcome.listed === 0) return { error: `Yelp found no bathroom remodeling businesses in ${city}, ${state}.` };
    return { message: describeRemodelerSearch(`${city}, ${state}`, outcome) };
  } catch (err) {
    if (err instanceof YelpError) return { error: err.message };
    logError("action.searchRemodelers", err);
    return { error: failureMessage(err, "The search stopped because of an unexpected error. Any remodelers already added are saved.") };
  }
}

export async function runRemodelerScrapeAction(): Promise<ActionResult> {
  const startedAt = Date.now();
  try {
    const target = await withRetry(() => pickNextRemodelerCity(prisma));
    const outcome = await searchRemodelers(target.city, target.state, {
      source: "Yelp search (Find remodelers button)",
      maxCreate: MAX_PER_RUN,
      deadline: startedAt + RUN_TIME_BUDGET_MS,
    });
    await withRetry(() => markRemodelerCityUsed(prisma, target.city, target.state));
    revalidate();
    return { ok: true, message: describeRemodelerSearch(`${target.city}, ${target.state}`, outcome) };
  } catch (err) {
    if (err instanceof YelpError) return { ok: false, error: err.message };
    logError("action.runRemodelerScrape", err);
    return {
      ok: false,
      error: failureMessage(err, "The run stopped because of an unexpected error. Any remodelers already added are saved."),
    };
  }
}
