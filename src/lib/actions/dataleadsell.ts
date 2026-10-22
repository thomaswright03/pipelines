"use server";

// dataleadsell-only server actions (manual entry, business-list search, the ADRE
// import). Everything the pipelines share lives in ./outreach.ts.
import { failureMessage } from "@/lib/db-health";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/log";
import { findBusinesses, PlaceSearchError } from "@/lib/place-discovery";
import { pickNextAgentCity, markAgentCityUsed } from "@/lib/agent-city-picker";
import { withRetry } from "@/lib/with-retry";
import { SOLD_COUNTIES, citiesInCounty, stateForCounty } from "@/lib/agent-cities";
import { agentLeadEditSchema, agentLeadSchema, type AgentLeadInput } from "@/lib/lead-forms";
import type { Prisma } from "@/generated/prisma/client";
import { createLeadsFromCandidates, describeDiscovery } from "@/lib/outreach/discovery";
import { agentLeadColumns, createManualLead, updateManualLead, type LeadFormState, type ManualLeadSpec } from "@/lib/outreach/manual-lead";
import { getAdreStatus, loadAdreRoster, processAdreChunk, type AdreChunkResult, type AdreStatus } from "@/lib/adre-import";
import { AdreEmptyRosterError, AdreFormatError } from "@/lib/az-adre";
import type { ActionResult } from "@/lib/outreach/lead-actions";

const BASE_PATH = "/dataleadsell";
const MAX_PER_RUN = 50;
// Every lookup ends by this long after the click (one in flight is cut
// off), which leaves room under the 60 s function limit for saving and the
// response. The business-list query is inside this budget.
const RUN_TIME_BUDGET_MS = 45 * 1000;

function revalidate(leadId?: string) {
  revalidatePath(BASE_PATH);
  revalidatePath(`${BASE_PATH}/stats`);
  if (leadId) revalidatePath(`${BASE_PATH}/${leadId}`);
}

// --- Manual entry and editing (shared with every pipeline: outreach/manual-lead.ts) ---

const manualLead: ManualLeadSpec<AgentLeadInput, AgentLeadInput & { name: string }> = {
  pipeline: "dataleadsell",
  createSchema: agentLeadSchema,
  editSchema: agentLeadEditSchema,
  columns: agentLeadColumns,
  insert: (db, data) => db.agentLead.create({ data: { ...(data as Prisma.AgentLeadUncheckedCreateInput), source: "Manual entry" } }),
  currentNotes: async (db, id) => (await db.agentLead.findUnique({ where: { id }, select: { notes: true } }))?.notes,
  logScopes: { create: "action.createAgent", update: "action.updateAgent" },
};

export async function createAgentAction(input: AgentLeadInput): Promise<LeadFormState<AgentLeadInput>> {
  return createManualLead(manualLead, input);
}

export async function updateAgentAction(leadId: string, input: AgentLeadInput): Promise<LeadFormState<AgentLeadInput>> {
  return updateManualLead(manualLead, leadId, input);
}

// --- Business-list discovery ---

const searchSchema = z
  .object({
    county: z.string().refine((v) => SOLD_COUNTIES.some((c) => c.county === v), "Pick one of the counties dataleadsell sells"),
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
    const results = await findBusinesses({ kind: "agent" }, city, state);
    if (results.length === 0) return { error: `The business list has no real estate agents in ${city}, ${state}.` };
    const result = await createLeadsFromCandidates("dataleadsell", results, {
      city,
      county,
      state,
      source: "Business list search",
      maxCreate: MAX_PER_RUN,
      deadline: startedAt + RUN_TIME_BUDGET_MS,
    });
    revalidate();
    return { message: describeDiscovery("dataleadsell", `${city}, ${county} County`, results.length, result) };
  } catch (err) {
    if (err instanceof PlaceSearchError) return { error: err.message };
    logError("action.searchAgents", err);
    return { error: failureMessage(err, "The search stopped because of an unexpected error. Any agents already added are saved.") };
  }
}

export async function runAgentPipelineScrapeAction(): Promise<ActionResult> {
  const startedAt = Date.now();
  try {
    const target = await withRetry(() => pickNextAgentCity(prisma));
    const results = await findBusinesses({ kind: "agent" }, target.city, target.state);
    await withRetry(() => markAgentCityUsed(prisma, target.city, target.county, target.state));
    const result = await createLeadsFromCandidates("dataleadsell", results, {
      city: target.city,
      county: target.county,
      state: target.state,
      source: "Business list (Run pipeline button)",
      maxCreate: MAX_PER_RUN,
      deadline: startedAt + RUN_TIME_BUDGET_MS,
    });
    revalidate();
    return { ok: true, message: describeDiscovery("dataleadsell", `${target.city}, ${target.county} County`, results.length, result) };
  } catch (err) {
    if (err instanceof PlaceSearchError) return { ok: false, error: err.message };
    logError("action.runAgentPipelineScrape", err);
    return { ok: false, error: failureMessage(err, "The run stopped because of an unexpected error. Any agents already added are saved.") };
  }
}

// --- ADRE (Maricopa) import: load the roster once, then work through it ---

type AdreStatusResult = { ok: true; status: AdreStatus } | { ok: false; error: string };

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

type AdreChunkActionResult = { ok: true; result: AdreChunkResult } | { ok: false; error: string };

export async function processAdreChunkAction(): Promise<AdreChunkActionResult> {
  try {
    const result = await processAdreChunk();
    revalidate();
    return { ok: true, result };
  } catch (err) {
    logError("action.processAdreChunk", err);
    return { ok: false, error: failureMessage(err, "The ADRE import stopped because of an unexpected error. Progress so far is saved.") };
  }
}
