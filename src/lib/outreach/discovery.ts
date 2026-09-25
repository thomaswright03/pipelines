// Shared lead discovery and email lookup for both pipelines: guess a
// website, find an address on it, apply the address rules, and save — the
// same way whether the candidates came from Yelp, the ADRE roster, the
// daily cron or a manual search.
import { prisma } from "@/lib/db";
import { logError } from "@/lib/log";
import { findEmailForBusiness } from "@/lib/email-finder";
import { guessWebsiteForBusiness, splitPersonAndBrokerage } from "@/lib/website-finder";
import { normalizePhone } from "@/lib/phone";
import { addressFilterFor } from "@/lib/outreach/email-policy";
import { getAppSettings } from "@/lib/outreach/settings";
import { DUPLICATE_BLOCK_PREFIX, findExistingPitch } from "@/lib/outreach/send";
import { getPipeline, type OutreachLead } from "@/lib/outreach/pipelines";
import type { PipelineId } from "@/lib/outreach/pipeline-id";

export type EmailLookup = { website: string | null; email: string | null };

/**
 * Upper bound on one lead's lookup (up to 3 site guesses + 4 page fetches),
 * so a batch's time budget can't be blown by one slow site.
 */
const LOOKUP_TIME_LIMIT_MS = 15_000;

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Finds an address for a lead. For dataleadsell agents, a site that belongs
 * to their brokerage only yields an address that is recognisably the
 * agent's own (see email-policy.ts).
 */
async function lookupEmail(
  pipelineId: PipelineId,
  lead: { name: string; brokerage?: string | null; website?: string | null },
): Promise<EmailLookup> {
  const isAgent = pipelineId === "dataleadsell";
  const split = isAgent ? splitPersonAndBrokerage(lead.name) : { person: lead.name, brokerage: null };
  const person = split.person;
  const brokerage = isAgent ? lead.brokerage || split.brokerage : null;

  const signal = AbortSignal.timeout(LOOKUP_TIME_LIMIT_MS);
  let website = lead.website?.trim() || null;
  let basis: "brokerage" | "name" | "given" = "given";
  if (website) {
    // A stored site for an agent with a brokerage is treated as the
    // brokerage's unless its domain carries the agent's own name.
    if (isAgent && brokerage) {
      const host = safeHostname(website);
      const lastName = slug(person.split(/\s+/).pop() ?? "");
      basis = lastName.length >= 3 && host.includes(lastName) ? "name" : "brokerage";
    }
  } else {
    const guess = await guessWebsiteForBusiness(lead.name, { brokerage, splitPersonName: isAgent, signal });
    website = guess?.url ?? null;
    basis = guess?.basedOn ?? "given";
  }

  const email = await findEmailForBusiness(website, addressFilterFor(person, basis), signal);
  return { website, email: email?.toLowerCase() ?? null };
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** Who else already uses this address (another lead here, or an earlier pitch). */
export async function describeAddressConflict(
  pipelineId: PipelineId,
  email: string,
  excludeLeadId?: string,
): Promise<string | null> {
  const pipeline = getPipeline(pipelineId);
  const [others, settings] = await Promise.all([
    pipeline.findLeadsByEmail(prisma, email, excludeLeadId),
    getAppSettings(),
  ]);
  if (others.length > 0) return `${email} already belongs to ${others[0]!.name}`;
  const pitched = await findExistingPitch(prisma, pipelineId, email, settings.allowCrossPipelineRepeats);
  if (pitched && !(pitched.pipeline === pipelineId && pitched.leadId === excludeLeadId)) {
    return `${email} was already pitched${pitched.leadName ? ` via ${pitched.leadName}` : ""}`;
  }
  return null;
}

export type DiscoveryCandidate = {
  name: string;
  phone: string | null;
  address: string | null;
  website: string | null;
  brokerage?: string | null;
  city?: string | null;
  notes?: string | null;
};

export type DiscoveryContext = {
  city: string | null;
  state: string | null;
  county?: string | null;
  source: string;
  maxCreate: number;
  /** Epoch ms after which no new candidate is started. */
  deadline: number;
};

export type DiscoveryResult = {
  created: { id: string; name: string; email: string }[];
  examined: number;
  skipped: { existingName: number; noEmail: number; addressInUse: number; optedOut: number };
  stoppedEarly: boolean;
};

/**
 * Saves the candidates an address was found for. A candidate is skipped
 * when a lead of the same name exists, no usable address turns up, the
 * address already belongs to another lead or was already pitched, or the
 * address opted out.
 */
export async function createLeadsFromCandidates(
  pipelineId: PipelineId,
  candidates: DiscoveryCandidate[],
  ctx: DiscoveryContext,
): Promise<DiscoveryResult> {
  const pipeline = getPipeline(pipelineId);
  const result: DiscoveryResult = {
    created: [],
    examined: 0,
    skipped: { existingName: 0, noEmail: 0, addressInUse: 0, optedOut: 0 },
    stoppedEarly: false,
  };

  const named = candidates.filter((c) => c.name.trim());
  const takenNames = await pipeline.findNamesTaken(prisma, named.map((c) => c.name));
  const emailsThisRun = new Set<string>();

  for (const candidate of named) {
    if (result.created.length >= ctx.maxCreate) break;
    if (Date.now() > ctx.deadline) {
      result.stoppedEarly = true;
      break;
    }
    const key = candidate.name.trim().toLowerCase();
    if (takenNames.has(key)) {
      result.skipped.existingName++;
      continue;
    }
    result.examined++;

    let lookup: EmailLookup;
    try {
      lookup = await lookupEmail(pipelineId, candidate);
    } catch (err) {
      logError("discovery.lookup", err, { pipeline: pipelineId, candidate: candidate.name });
      lookup = { website: null, email: null };
    }
    if (!lookup.email) {
      result.skipped.noEmail++;
      continue;
    }
    const email = lookup.email;
    if (emailsThisRun.has(email) || (await describeAddressConflict(pipelineId, email))) {
      result.skipped.addressInUse++;
      continue;
    }
    if (await prisma.suppressedEmail.findUnique({ where: { email } })) {
      result.skipped.optedOut++;
      continue;
    }

    takenNames.add(key);
    emailsThisRun.add(email);
    const lead = await pipeline.createLead(prisma, {
      name: candidate.name.trim(),
      brokerage: candidate.brokerage ?? null,
      phone: normalizePhone(candidate.phone),
      address: candidate.address,
      website: lookup.website,
      email,
      city: candidate.city ?? ctx.city,
      county: ctx.county ?? null,
      state: ctx.state,
      source: ctx.source,
      notes: candidate.notes ?? null,
      emailCheckedAt: new Date(),
    });
    result.created.push({ id: lead.id, name: lead.name, email });
  }
  return result;
}

// --- Email lookup for leads that already exist ----------------------------

/** Moves a lead whose email channel didn't pan out to phone outreach. */
export async function routeToPhoneOutreach(
  pipelineId: PipelineId,
  lead: Pick<OutreachLead, "id" | "phone">,
): Promise<"cold_call_list" | "contactless_list"> {
  const status = lead.phone ? "cold_call_list" : "contactless_list";
  await getPipeline(pipelineId).update(prisma, lead.id, { status });
  return status;
}

export type FindEmailOutcome =
  | { found: true; email: string; blockedReason: string | null }
  | { found: false; routedTo: "cold_call_list" | "contactless_list" | null };

/** Looks up an address for an existing lead and records the result either way. */
export async function findEmailForLead(pipelineId: PipelineId, lead: OutreachLead): Promise<FindEmailOutcome> {
  const pipeline = getPipeline(pipelineId);
  const lookup = await lookupEmail(pipelineId, lead);
  const checkedAt = new Date();

  if (!lookup.email) {
    await pipeline.update(prisma, lead.id, { website: lookup.website, emailCheckedAt: checkedAt });
    const routedTo = lead.status === "new" ? await routeToPhoneOutreach(pipelineId, lead) : null;
    return { found: false, routedTo };
  }

  const conflict = await describeAddressConflict(pipelineId, lookup.email, lead.id);
  const blockedReason = conflict ? `${DUPLICATE_BLOCK_PREFIX} — ${conflict}, so this lead is never auto-sent.` : null;
  await pipeline.update(prisma, lead.id, {
    email: lookup.email,
    website: lookup.website,
    emailCheckedAt: checkedAt,
    ...(blockedReason ? { sendBlockedReason: blockedReason } : {}),
  });
  return { found: true, email: lookup.email, blockedReason };
}

const BULK_FIND_CHUNK_SIZE = 5;
const BULK_FIND_TIME_BUDGET_MS = 20_000;

export type BulkFindResult = { checked: number; found: number; remaining: number };

/**
 * One chunk of the "Find emails for all leads" sweep: leads never checked
 * before, oldest first. Small and time-boxed so each call stays well under
 * the function limit; the client loops to show live progress.
 */
export async function findEmailsChunk(pipelineId: PipelineId): Promise<BulkFindResult> {
  const pipeline = getPipeline(pipelineId);
  const leads = await pipeline.listNeedingEmailLookup(prisma, BULK_FIND_CHUNK_SIZE);
  const deadline = Date.now() + BULK_FIND_TIME_BUDGET_MS;
  let checked = 0;
  let found = 0;
  for (const lead of leads) {
    if (checked > 0 && Date.now() > deadline) break;
    checked++;
    try {
      const outcome = await findEmailForLead(pipelineId, lead);
      if (outcome.found) found++;
    } catch (err) {
      logError("discovery.findEmailsChunk", err, { pipeline: pipelineId, leadId: lead.id });
      // Record the attempt so the sweep moves on instead of retrying forever.
      await pipeline.update(prisma, lead.id, { emailCheckedAt: new Date() });
    }
  }
  const remaining = await pipeline.countNeedingEmailLookup(prisma);
  return { checked, found, remaining };
}
