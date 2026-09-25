// Shared lead discovery and email lookup for both pipelines: guess a
// website, find an address on it, apply the address rules, and save — the
// same way whether the candidates came from Yelp, the ADRE roster, the
// daily cron or a manual search.
import { prisma } from "@/lib/db";
import { logError } from "@/lib/log";
import { scanWebsite } from "@/lib/email-finder";
import { guessWebsiteForBusiness, splitPersonAndBrokerage } from "@/lib/website-finder";
import { digitsOnly, normalizePhone } from "@/lib/phone";
import { addressFilterFor } from "@/lib/outreach/email-policy";
import { siteEvidence, type LeadFacts } from "@/lib/outreach/site-evidence";
import { getAppSettings } from "@/lib/outreach/settings";
import { DUPLICATE_BLOCK_PREFIX, findExistingPitch } from "@/lib/outreach/send";
import { getPipeline, type NamedLead, type OutreachLead } from "@/lib/outreach/pipelines";
import { PIPELINE_BASE_PATH, type PipelineId } from "@/lib/outreach/pipeline-id";

/**
 * The outcome of looking for a lead's address.
 * - `email` + `evidence`: an address on a site that is the lead's own
 *   (entered on the lead, or a guessed site that shows the lead's phone,
 *   street or city).
 * - `unverified`: an address was found, but on a guessed site nothing ties
 *   to the lead — it is not saved, only reported.
 */
export type EmailLookup = {
  website: string | null;
  email: string | null;
  evidence: string | null;
  unverified: { website: string; email: string } | null;
};

const NO_LOOKUP: EmailLookup = { website: null, email: null, evidence: null, unverified: null };

/**
 * Upper bound on one lead's lookup (up to 3 site guesses + 4 page fetches),
 * so a batch's time budget can't be blown by one slow site. A lookup is
 * also cut short at the batch's deadline (see createLeadsFromCandidates).
 */
export const LOOKUP_TIME_LIMIT_MS = 15_000;
/** A lookup isn't started with less time than this left before the deadline. */
const MIN_LOOKUP_MS = 2_000;

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Finds an address for a lead. For dataleadsell agents, a site that belongs
 * to their brokerage only yields an address that is recognisably the
 * agent's own (see email-policy.ts). A guessed site must also show the
 * lead's phone, street address or city (see site-evidence.ts).
 */
async function lookupEmail(
  pipelineId: PipelineId,
  lead: { name: string; brokerage?: string | null; website?: string | null } & LeadFacts,
  signal: AbortSignal,
): Promise<EmailLookup> {
  const isAgent = pipelineId === "dataleadsell";
  const split = isAgent ? splitPersonAndBrokerage(lead.name) : { person: lead.name, brokerage: null };
  const person = split.person;
  const brokerage = isAgent ? lead.brokerage || split.brokerage : null;

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
    if (!guess) return NO_LOOKUP;
    website = guess.url;
    basis = guess.basedOn;
  }

  const scan = await scanWebsite(website, signal);
  const email = scan.emails.find(addressFilterFor(person, basis))?.toLowerCase() ?? null;
  if (!email) return { ...NO_LOOKUP, website: lead.website?.trim() ? website : null };

  if (lead.website?.trim()) {
    return { website, email, evidence: `Found on ${safeHostname(website) || website}, the website saved on this lead.`, unverified: null };
  }
  const evidence = siteEvidence(website, scan.pages, lead);
  if (!evidence) return { ...NO_LOOKUP, unverified: { website, email } };
  return { website, email, evidence, unverified: null };
}

export type AddressConflict = { message: string; href: string | null; leadName: string | null };

/** Who else already uses this address (another lead here, or an earlier pitch), with a link to them. */
export async function findAddressConflict(
  pipelineId: PipelineId,
  email: string,
  excludeLeadId?: string,
): Promise<AddressConflict | null> {
  const pipeline = getPipeline(pipelineId);
  const [others, settings] = await Promise.all([
    pipeline.findLeadsByEmail(prisma, email, excludeLeadId),
    getAppSettings(),
  ]);
  if (others.length > 0) {
    const other = others[0]!;
    return { message: `${email} already belongs to ${other.name}`, href: `${pipeline.basePath}/${other.id}`, leadName: other.name };
  }
  const pitched = await findExistingPitch(prisma, pipelineId, email, settings.allowCrossPipelineRepeats);
  if (pitched && !(pitched.pipeline === pipelineId && pitched.leadId === excludeLeadId)) {
    return {
      message: `${email} was already pitched${pitched.leadName ? ` via ${pitched.leadName}` : ""}`,
      href: pitched.leadId && pitched.leadName ? `${PIPELINE_BASE_PATH[pitched.pipeline]}/${pitched.leadId}` : null,
      leadName: pitched.leadName,
    };
  }
  return null;
}

/** Who else already uses this address, in words (see findAddressConflict). */
export async function describeAddressConflict(
  pipelineId: PipelineId,
  email: string,
  excludeLeadId?: string,
): Promise<string | null> {
  return (await findAddressConflict(pipelineId, email, excludeLeadId))?.message ?? null;
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
  /**
   * Epoch ms by which every lookup must have finished: none starts with
   * less than a couple of seconds left, and one in progress is cut off here.
   */
  deadline: number;
  /** The clock (tests pass a fake one). */
  now?: () => number;
};

export type DiscoveryResult = {
  created: { id: string; name: string; email: string }[];
  examined: number;
  skipped: { existingName: number; noEmail: number; unverifiedSite: number; addressInUse: number; optedOut: number };
  stoppedEarly: boolean;
};

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeText(value: string | null | undefined): string | null {
  const v = value?.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return v || null;
}

/**
 * Whether a candidate is the same lead as an existing one with the same
 * name. Two leads with one name are told apart by phone, then street
 * address, then city; when neither has anything to compare, they are
 * treated as the same (so a re-run never duplicates a lead).
 */
export function isSameLead(
  a: { name: string; phone: string | null; address: string | null; city: string | null },
  b: { name: string; phone: string | null; address: string | null; city: string | null },
): boolean {
  if (normalizeName(a.name) !== normalizeName(b.name)) return false;
  const phoneA = a.phone ? digitsOnly(a.phone) : null;
  const phoneB = b.phone ? digitsOnly(b.phone) : null;
  if (phoneA && phoneB) return phoneA === phoneB;
  const addrA = normalizeText(a.address);
  const addrB = normalizeText(b.address);
  if (addrA && addrB) return addrA === addrB;
  const cityA = normalizeText(a.city);
  const cityB = normalizeText(b.city);
  if (cityA && cityB) return cityA === cityB;
  return true;
}

/**
 * Saves the candidates an address was found for. A candidate is skipped
 * when it is already a lead (same name and same phone/address/city), no
 * usable address turns up, the address was only on a site that couldn't be
 * tied to the candidate, the address already belongs to another lead or was
 * already pitched, or the address opted out.
 */
export async function createLeadsFromCandidates(
  pipelineId: PipelineId,
  candidates: DiscoveryCandidate[],
  ctx: DiscoveryContext,
): Promise<DiscoveryResult> {
  const pipeline = getPipeline(pipelineId);
  const now = ctx.now ?? Date.now;
  const result: DiscoveryResult = {
    created: [],
    examined: 0,
    skipped: { existingName: 0, noEmail: 0, unverifiedSite: 0, addressInUse: 0, optedOut: 0 },
    stoppedEarly: false,
  };

  const named = candidates.filter((c) => c.name.trim());
  const known: NamedLead[] = await pipeline.findSameNamed(prisma, named.map((c) => c.name));
  const emailsThisRun = new Set<string>();

  for (const candidate of named) {
    if (result.created.length >= ctx.maxCreate) break;
    const facts = {
      name: candidate.name,
      phone: normalizePhone(candidate.phone),
      address: candidate.address,
      city: candidate.city ?? ctx.city,
    };
    if (known.some((lead) => isSameLead(lead, facts))) {
      result.skipped.existingName++;
      continue;
    }
    const remaining = ctx.deadline - now();
    if (remaining < MIN_LOOKUP_MS) {
      result.stoppedEarly = true;
      break;
    }
    // Cut the lookup off at the deadline, not just at its own limit.
    const cappedByDeadline = remaining < LOOKUP_TIME_LIMIT_MS;
    const signal = AbortSignal.timeout(Math.min(LOOKUP_TIME_LIMIT_MS, remaining));

    let lookup: EmailLookup;
    try {
      lookup = await lookupEmail(pipelineId, { ...candidate, ...facts }, signal);
    } catch (err) {
      logError("discovery.lookup", err, { pipeline: pipelineId, candidate: candidate.name });
      lookup = NO_LOOKUP;
    }
    if (signal.aborted && cappedByDeadline && !lookup.email) {
      // Ran out of batch time mid-lookup: not a verdict on this candidate.
      result.stoppedEarly = true;
      break;
    }
    result.examined++;
    if (!lookup.email) {
      if (lookup.unverified) result.skipped.unverifiedSite++;
      else result.skipped.noEmail++;
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

    emailsThisRun.add(email);
    const lead = await pipeline.createLead(prisma, {
      name: candidate.name.trim(),
      brokerage: candidate.brokerage ?? null,
      phone: facts.phone,
      address: candidate.address,
      website: lookup.website,
      email,
      emailEvidence: lookup.evidence,
      city: facts.city,
      county: ctx.county ?? null,
      state: ctx.state,
      source: ctx.source,
      notes: candidate.notes ?? null,
      emailCheckedAt: new Date(),
    });
    known.push({ id: lead.id, name: lead.name, phone: lead.phone, address: lead.address, city: lead.city });
    result.created.push({ id: lead.id, name: lead.name, email });
  }
  return result;
}

/** One line for the operator about what a discovery run did. */
export function describeDiscovery(
  pipelineId: PipelineId,
  where: string,
  scraped: number,
  result: DiscoveryResult,
): string {
  const isAgents = pipelineId === "dataleadsell";
  const skipped: string[] = [];
  if (result.skipped.existingName) skipped.push(`${result.skipped.existingName} already in the list`);
  if (result.skipped.noEmail) {
    skipped.push(`${result.skipped.noEmail} with no ${isAgents ? "usable email of their own" : "findable email"}`);
  }
  if (result.skipped.unverifiedSite) {
    skipped.push(`${result.skipped.unverifiedSite} whose guessed website couldn't be confirmed as theirs`);
  }
  if (result.skipped.addressInUse) skipped.push(`${result.skipped.addressInUse} whose email is already in use`);
  if (result.skipped.optedOut) skipped.push(`${result.skipped.optedOut} opted out`);
  const created = result.created.length;
  return (
    `Found ${scraped} ${isAgents ? "agents" : "businesses"} in ${where} and added ${created} new ${isAgents ? (created === 1 ? "agent" : "agents") : created === 1 ? "lead" : "leads"}` +
    (skipped.length ? ` (skipped ${skipped.join(", ")})` : "") +
    (result.stoppedEarly ? ". Stopped early to stay within the time limit — run again for more." : ".")
  );
}

// --- Email lookup for leads that already exist ----------------------------

/**
 * Moves a lead whose email channel didn't pan out to phone outreach — only
 * if it is still in the status it was read in (`from`), so a reply or a
 * manual change that landed in between is never overwritten. Returns the
 * list it moved to, or null if the lead had already moved on.
 */
export async function routeToPhoneOutreach(
  pipelineId: PipelineId,
  lead: Pick<OutreachLead, "id" | "phone" | "status">,
): Promise<"cold_call_list" | "contactless_list" | null> {
  const status = lead.phone ? "cold_call_list" : "contactless_list";
  const moved = await getPipeline(pipelineId).updateIfStatus(prisma, lead.id, [lead.status], { status });
  return moved ? status : null;
}

export type FindEmailOutcome =
  | { found: true; email: string; evidence: string | null; blockedReason: string | null }
  | {
      found: false;
      routedTo: "cold_call_list" | "contactless_list" | null;
      unverified: { website: string; email: string } | null;
    };

/** Looks up an address for an existing lead and records the result either way. */
export async function findEmailForLead(pipelineId: PipelineId, lead: OutreachLead): Promise<FindEmailOutcome> {
  const pipeline = getPipeline(pipelineId);
  const lookup = await lookupEmail(pipelineId, lead, AbortSignal.timeout(LOOKUP_TIME_LIMIT_MS));
  const checkedAt = new Date();

  if (!lookup.email) {
    await pipeline.update(prisma, lead.id, { website: lookup.website ?? lead.website, emailCheckedAt: checkedAt });
    const routedTo = lead.status === "new" ? await routeToPhoneOutreach(pipelineId, lead) : null;
    return { found: false, routedTo, unverified: lookup.unverified };
  }

  const conflict = await describeAddressConflict(pipelineId, lookup.email, lead.id);
  const blockedReason = conflict ? `${DUPLICATE_BLOCK_PREFIX} — ${conflict}, so this lead is never auto-sent.` : null;
  await pipeline.update(prisma, lead.id, {
    email: lookup.email,
    emailEvidence: lookup.evidence,
    website: lookup.website,
    emailCheckedAt: checkedAt,
    ...(blockedReason ? { sendBlockedReason: blockedReason } : {}),
  });
  return { found: true, email: lookup.email, evidence: lookup.evidence, blockedReason };
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
