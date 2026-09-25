"use server";

// dataleadsell-only server actions (manual entry, Yelp search, the ADRE
// import). Everything both pipelines share lives in ./outreach.ts.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/log";
import { normalizePhone } from "@/lib/phone";
import { findBusinessesViaYelp, YelpError } from "@/lib/yelp-discovery";
import { pickNextAgentCity, markAgentCityUsed } from "@/lib/agent-city-picker";
import { withRetry } from "@/lib/with-retry";
import { SOLD_COUNTIES, citiesInCounty, stateForCounty } from "@/lib/agent-cities";
import {
  agentLeadEditSchema,
  agentLeadSchema,
  fieldErrorsOf,
  normalizeWebsite,
  type AgentLeadInput,
  type FormState,
} from "@/lib/lead-forms";
import { createLeadsFromCandidates, describeDiscovery } from "@/lib/outreach/discovery";
import { checkAddressForLead, editLead } from "@/lib/outreach/lead-edit";
import { enteredByHandEvidence } from "@/lib/outreach/evidence";
import { getAdreStatus, loadAdreRoster, processAdreChunk, type AdreChunkResult, type AdreStatus } from "@/lib/adre-import";
import { AdreEmptyRosterError, AdreFormatError } from "@/lib/az-adre";
import type { ActionResult } from "@/lib/outreach/lead-actions";

const BASE_PATH = "/dataleadsell";
const BUSINESS_TYPE = "real estate agent";
const MAX_PER_RUN = 50;
// Every lookup ends by this long after the click (one in flight is cut
// off), which leaves room under the 60 s function limit for saving and the
// response. The Yelp call (≤10 s) is inside this budget.
const RUN_TIME_BUDGET_MS = 45 * 1000;
const UNEXPECTED = "Something went wrong saving that — nothing was changed. Try again in a moment.";

function revalidate(leadId?: string) {
  revalidatePath(BASE_PATH);
  revalidatePath(`${BASE_PATH}/stats`);
  if (leadId) revalidatePath(`${BASE_PATH}/${leadId}`);
}

// --- Manual entry and editing ---

export type AgentFormState = FormState<AgentLeadInput> & { leadId?: string };

function agentColumns(d: AgentLeadInput & { name: string }) {
  return {
    name: d.name,
    brokerage: d.brokerage || null,
    phone: normalizePhone(d.phone),
    city: d.city || null,
    county: d.county || null,
    state: d.county ? stateForCounty(d.county) : null,
    website: normalizeWebsite(d.website ?? ""),
    notes: d.notes || null,
  };
}

export async function createAgentAction(input: AgentLeadInput): Promise<AgentFormState> {
  const parsed = agentLeadSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Fix the highlighted fields.", fieldErrors: fieldErrorsOf<AgentLeadInput>(parsed.error) };
  }
  const d = parsed.data;
  const email = d.email ? d.email.toLowerCase() : null;
  try {
    if (email) {
      const problem = await checkAddressForLead("dataleadsell", email);
      if (problem) {
        return {
          error: "This email can't be used.",
          fieldErrors: { email: problem.message },
          ...(problem.link ? { fieldLinks: { email: problem.link } } : {}),
        };
      }
    }
    const lead = await prisma.agentLead.create({
      data: {
        ...agentColumns(d),
        email,
        emailEvidence: email ? enteredByHandEvidence() : null,
        source: "Manual entry",
      },
    });
    revalidate();
    return { ok: true, leadId: lead.id };
  } catch (err) {
    logError("action.createAgent", err);
    return { error: UNEXPECTED };
  }
}

export async function updateAgentAction(leadId: string, input: AgentLeadInput): Promise<AgentFormState> {
  const existing = await prisma.agentLead.findUnique({ where: { id: leadId }, select: { notes: true } }).catch(() => null);
  const parsed = agentLeadEditSchema(existing?.notes).safeParse(input);
  if (!parsed.success) {
    return { error: "Fix the highlighted fields.", fieldErrors: fieldErrorsOf<AgentLeadInput>(parsed.error) };
  }
  const d = parsed.data;
  try {
    const outcome = await editLead("dataleadsell", leadId, d.email || null, agentColumns(d));
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
    logError("action.updateAgent", err, { leadId });
    return { error: UNEXPECTED };
  }
}

// --- Yelp discovery ---

const searchSchema = z
  .object({
    county: z
      .string()
      .refine((v) => SOLD_COUNTIES.some((c) => c.county === v), "Pick one of the counties dataleadsell sells"),
    city: z.string().trim().min(1, "Pick a city"),
  })
  .refine((v) => citiesInCounty(v.county).includes(v.city), { message: "Pick a city in that county", path: ["city"] });

export type AgentSearchState = { error?: string; message?: string };

export async function searchAgentsAction(_prev: AgentSearchState, formData: FormData): Promise<AgentSearchState> {
  const parsed = searchSchema.safeParse({
    county: String(formData.get("county") ?? ""),
    city: String(formData.get("city") ?? ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the search fields." };
  const { county, city } = parsed.data;
  const state = stateForCounty(county)!;
  const startedAt = Date.now();

  try {
    const results = await findBusinessesViaYelp(BUSINESS_TYPE, `${city}, ${state}`);
    if (results.length === 0) return { error: `Yelp found no real estate agents in ${city}, ${state}.` };
    const result = await createLeadsFromCandidates("dataleadsell", results, {
      city,
      county,
      state,
      source: "Yelp search",
      maxCreate: MAX_PER_RUN,
      deadline: startedAt + RUN_TIME_BUDGET_MS,
    });
    revalidate();
    return { message: describeDiscovery("dataleadsell", `${city}, ${county} County`, results.length, result) };
  } catch (err) {
    if (err instanceof YelpError) return { error: err.message };
    logError("action.searchAgents", err);
    return { error: "The search stopped because of an unexpected error. Any agents already added are saved." };
  }
}

export async function runAgentPipelineScrapeAction(): Promise<ActionResult> {
  const startedAt = Date.now();
  try {
    const target = await withRetry(() => pickNextAgentCity(prisma));
    const results = await findBusinessesViaYelp(BUSINESS_TYPE, `${target.city}, ${target.state}`);
    await withRetry(() => markAgentCityUsed(prisma, target.city, target.county, target.state));
    const result = await createLeadsFromCandidates("dataleadsell", results, {
      city: target.city,
      county: target.county,
      state: target.state,
      source: "Yelp search (Run pipeline button)",
      maxCreate: MAX_PER_RUN,
      deadline: startedAt + RUN_TIME_BUDGET_MS,
    });
    revalidate();
    return { ok: true, message: describeDiscovery("dataleadsell", `${target.city}, ${target.county} County`, results.length, result) };
  } catch (err) {
    if (err instanceof YelpError) return { ok: false, error: err.message };
    logError("action.runAgentPipelineScrape", err);
    return { ok: false, error: "The run stopped because of an unexpected error. Any agents already added are saved." };
  }
}

// --- ADRE (Maricopa) import: load the roster once, then work through it ---

export type AdreStatusResult = { ok: true; status: AdreStatus } | { ok: false; error: string };

export async function loadAdreRosterAction(): Promise<AdreStatusResult> {
  try {
    await loadAdreRoster();
    return { ok: true, status: await getAdreStatus() };
  } catch (err) {
    if (err instanceof AdreFormatError) {
      logError("action.loadAdreRoster", err, { missing: err.missing.join("|"), columnsReceived: err.columns.join("|") });
      return {
        ok: false,
        error: "ADRE's roster format changed — the import can't read it, so nothing was changed. Ask your developer to update the import.",
      };
    }
    if (err instanceof AdreEmptyRosterError) {
      logError("action.loadAdreRoster", err, { rows: err.rows });
      return {
        ok: false,
        error: `ADRE's roster downloaded but lists no active ${err.county} County real-estate licensees, which isn't right — nothing was changed. Try again later; if it keeps happening, ask your developer to check the import.`,
      };
    }
    logError("action.loadAdreRoster", err);
    return {
      ok: false,
      error: "Couldn't download ADRE's license roster (their site may be slow or down). Nothing changed — try again later.",
    };
  }
}

export type AdreChunkActionResult = { ok: true; result: AdreChunkResult } | { ok: false; error: string };

export async function processAdreChunkAction(): Promise<AdreChunkActionResult> {
  try {
    const result = await processAdreChunk();
    revalidate();
    return { ok: true, result };
  } catch (err) {
    logError("action.processAdreChunk", err);
    return { ok: false, error: "The ADRE import stopped because of an unexpected error. Progress so far is saved." };
  }
}
