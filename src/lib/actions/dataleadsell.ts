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
import { agentLeadSchema, fieldErrorsOf, normalizeWebsite, type AgentLeadInput, type FormState } from "@/lib/lead-forms";
import { createLeadsFromCandidates, describeAddressConflict } from "@/lib/outreach/discovery";
import { getAdreStatus, loadAdreRoster, processAdreChunk, type AdreChunkResult, type AdreStatus } from "@/lib/adre-import";
import type { ActionResult } from "@/lib/outreach/lead-actions";

const BASE_PATH = "/dataleadsell";
const BUSINESS_TYPE = "real estate agent";
const MAX_PER_RUN = 50;
// Leaves room under the 60 s function limit for the Yelp call (≤10 s) and
// the last lookup in flight (≤15 s).
const RUN_TIME_BUDGET_MS = 25 * 1000;
const UNEXPECTED = "Something went wrong saving that — nothing was changed. Try again in a moment.";

function revalidate() {
  revalidatePath(BASE_PATH);
  revalidatePath(`${BASE_PATH}/stats`);
}

// --- Manual entry ---

export type AgentFormState = FormState<AgentLeadInput> & { leadId?: string };

export async function createAgentAction(input: AgentLeadInput): Promise<AgentFormState> {
  const parsed = agentLeadSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Fix the highlighted fields.", fieldErrors: fieldErrorsOf<AgentLeadInput>(parsed.error) };
  }
  const d = parsed.data;
  const email = d.email ? d.email.toLowerCase() : null;
  try {
    if (email) {
      const conflict = await describeAddressConflict("dataleadsell", email);
      if (conflict) {
        return {
          error: "This email is already in use.",
          fieldErrors: { email: `${conflict} — each address gets one pitch. Edit that agent instead.` },
        };
      }
    }
    const lead = await prisma.agentLead.create({
      data: {
        name: d.name,
        brokerage: d.brokerage || null,
        email,
        phone: normalizePhone(d.phone),
        city: d.city || null,
        county: d.county || null,
        state: d.county ? stateForCounty(d.county) : null,
        website: normalizeWebsite(d.website),
        notes: d.notes || null,
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

// --- Yelp discovery ---

type DiscoveryResult = Awaited<ReturnType<typeof createLeadsFromCandidates>>;

function describeDiscovery(where: string, scraped: number, result: DiscoveryResult) {
  const skipped: string[] = [];
  if (result.skipped.existingName) skipped.push(`${result.skipped.existingName} already in the list`);
  if (result.skipped.noEmail) skipped.push(`${result.skipped.noEmail} with no usable email of their own`);
  if (result.skipped.addressInUse) skipped.push(`${result.skipped.addressInUse} whose email is already in use`);
  if (result.skipped.optedOut) skipped.push(`${result.skipped.optedOut} opted out`);
  return (
    `Found ${scraped} agents in ${where} and added ${result.created.length} new` +
    (skipped.length ? ` (skipped ${skipped.join(", ")})` : "") +
    (result.stoppedEarly ? ". Stopped early to stay within the time limit — run again for more." : ".")
  );
}

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
    return { message: describeDiscovery(`${city}, ${county} County`, results.length, result) };
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
    return { ok: true, message: describeDiscovery(`${target.city}, ${target.county} County`, results.length, result) };
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
