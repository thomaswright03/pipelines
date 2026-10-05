// Shared lead discovery and email lookup for every pipeline: guess a
// website, find an address on it, apply the address rules, and save — the
// same way whether the candidates came from Yelp, the ADRE roster, the
// daily cron or a manual search.
import { prisma } from "@/lib/db";
import { logError } from "@/lib/log";
import { scanWebsite } from "@/lib/email-finder";
import { guessWebsiteForBusiness, splitPersonAndBrokerage } from "@/lib/website-finder";
import { digitsOnly, normalizePhone } from "@/lib/phone";
import { ADDRESS_RULES_VERSION, addressFilterFor, hostNamesPerson } from "@/lib/outreach/email-policy";
import { SITE_RULES_VERSION, siteEvidence, type LeadFacts } from "@/lib/outreach/site-evidence";
import { getAppSettings } from "@/lib/outreach/settings";
import { DUPLICATE_BLOCK_PREFIX, findExistingPitch } from "@/lib/outreach/send";
import { getPipeline, type Db, type NamedLead, type OutreachLead } from "@/lib/outreach/pipelines";
import { LEAD_NOUN, PIPELINE_BASE_PATH, type PipelineId } from "@/lib/outreach/pipeline-id";

/**
 * The outcome of looking for a lead's address.
 * - `email` + `evidence`: an address on a site that is the lead's own
 *   (entered on the lead, or a guessed site that shows the lead's phone or
 *   street, or its city plus the lead's name — see site-evidence.ts).
 * - `unverified`: an address was found, but on a guessed site nothing ties
 *   to the lead — it is not saved, only reported.
 * - `unreachable`: the lead's site (or a candidate site) couldn't be read —
 *   timeout, connection error, 5xx — so "no address" isn't a verdict.
 */
type EmailLookup = {
  website: string | null;
  email: string | null;
  evidence: string | null;
  unverified: { website: string; email: string } | null;
  unreachable: boolean;
};

/** The rules that accept a found address, stored on the lead with it. */
export const EMAIL_RULES_VERSION = `${ADDRESS_RULES_VERSION} ${SITE_RULES_VERSION}`;

const NO_LOOKUP: EmailLookup = { website: null, email: null, evidence: null, unverified: null, unreachable: false };

/**
 * Upper bound on one lead's lookup (up to 3 site guesses + 4 page fetches),
 * so a batch's time budget can't be blown by one slow site. A lookup is
 * also cut short at the batch's deadline (see createLeadsFromCandidates).
 */
const LOOKUP_TIME_LIMIT_MS = 15_000;
/** A lookup isn't started with less time than this left before the deadline. */
const MIN_LOOKUP_MS = 2_000;

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
 * lead's phone or street address, or its city plus a name signal (see
 * site-evidence.ts).
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
    if (isAgent && brokerage) basis = hostNamesPerson(safeHostname(website), person) ? "name" : "brokerage";
  } else {
    const { guess, inconclusive } = await guessWebsiteForBusiness(lead.name, { brokerage, splitPersonName: isAgent, signal });
    if (!guess) return { ...NO_LOOKUP, unreachable: inconclusive };
    website = guess.url;
    basis = guess.basedOn;
  }

  const scan = await scanWebsite(website, signal);
  const email = scan.emails.find(addressFilterFor(person, basis))?.toLowerCase() ?? null;
  if (!email) return { ...NO_LOOKUP, website: lead.website?.trim() ? website : null, unreachable: scan.unreachable };

  if (lead.website?.trim()) {
    return {
      ...NO_LOOKUP,
      website,
      email,
      evidence: `Found on ${safeHostname(website) || website}, the website saved on this lead.`,
    };
  }
  const evidence = siteEvidence(website, scan.pages, { ...lead, name: person, addressNamesLead: basis === "brokerage" });
  if (!evidence) return { ...NO_LOOKUP, unverified: { website, email } };
  return { ...NO_LOOKUP, website, email, evidence };
}

type AddressConflict = {
  message: string;
  href: string | null;
  leadName: string | null;
  /** The address is taken because the recipient's mail server refused it, not because it was pitched. */
  refused?: boolean;
};

/** Who else already uses this address (another lead here, or an earlier pitch), with a link to them. */
export async function findAddressConflict(
  pipelineId: PipelineId,
  email: string,
  excludeLeadId?: string,
  db: Db = prisma,
): Promise<AddressConflict | null> {
  const pipeline = getPipeline(pipelineId);
  // One after the other: inside a transaction (db) queries can't run in parallel.
  const others = await pipeline.findLeadsByEmail(db, email, excludeLeadId);
  const settings = await getAppSettings(db);
  if (others.length > 0) {
    const other = others[0]!;
    return { message: `${email} already belongs to ${other.name}`, href: `${pipeline.basePath}/${other.id}`, leadName: other.name };
  }
  const pitched = await findExistingPitch(db, pipelineId, email, settings.allowCrossPipelineRepeats);
  if (pitched && !(pitched.pipeline === pipelineId && pitched.leadId === excludeLeadId)) {
    return {
      message: pitched.refused
        ? `${email} was refused by the recipient's mail server${pitched.leadName ? ` when emailing ${pitched.leadName}` : ""}`
        : `${email} was already pitched${pitched.leadName ? ` via ${pitched.leadName}` : ""}`,
      refused: pitched.refused,
      href: pitched.leadId && pitched.leadName ? `${PIPELINE_BASE_PATH[pitched.pipeline]}/${pitched.leadId}` : null,
      leadName: pitched.leadName,
    };
  }
  return null;
}

/** Who else already uses this address, in words (see findAddressConflict). */
async function describeAddressConflict(pipelineId: PipelineId, email: string, excludeLeadId?: string): Promise<string | null> {
  return (await findAddressConflict(pipelineId, email, excludeLeadId))?.message ?? null;
}

export type DiscoveryCandidate = {
  name: string;
  phone: string | null;
  address: string | null;
  website: string | null;
  brokerage?: string | null;
  /** The business's Yelp categories (Garbage AI stores them). */
  services?: string | null;
  city?: string | null;
  notes?: string | null;
};

type DiscoveryContext = {
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
  skipped: {
    existingName: number;
    noEmail: number;
    unverifiedSite: number;
    addressInUse: number;
    optedOut: number;
    /** The website couldn't be read (timeout, connection error, 5xx); a later run will look again. */
    unreachable: number;
  };
  stoppedEarly: boolean;
};

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeText(value: string | null | undefined): string | null {
  const v = value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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
    skipped: { existingName: 0, noEmail: 0, unverifiedSite: 0, addressInUse: 0, optedOut: 0, unreachable: 0 },
    stoppedEarly: false,
  };

  const named = candidates.filter((c) => c.name.trim());
  const known: NamedLead[] = await pipeline.findSameNamed(
    prisma,
    named.map((c) => c.name),
  );
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
      else if (lookup.unreachable) result.skipped.unreachable++;
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
      services: candidate.services ?? null,
      phone: facts.phone,
      address: candidate.address,
      website: lookup.website,
      email,
      emailEvidence: lookup.evidence,
      emailRulesVersion: EMAIL_RULES_VERSION,
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
export function describeDiscovery(pipelineId: PipelineId, where: string, scraped: number, result: DiscoveryResult): string {
  const isAgents = pipelineId === "dataleadsell";
  const skipped: string[] = [];
  if (result.skipped.existingName) skipped.push(`${result.skipped.existingName} already in the list`);
  if (result.skipped.noEmail) {
    skipped.push(`${result.skipped.noEmail} with no ${isAgents ? "usable email of their own" : "findable email"}`);
  }
  if (result.skipped.unverifiedSite) {
    skipped.push(`${result.skipped.unverifiedSite} whose guessed website couldn't be confirmed as theirs`);
  }
  if (result.skipped.unreachable) {
    skipped.push(`${result.skipped.unreachable} whose website couldn't be reached (a later run will try again)`);
  }
  if (result.skipped.addressInUse) skipped.push(`${result.skipped.addressInUse} whose email is already in use`);
  if (result.skipped.optedOut) skipped.push(`${result.skipped.optedOut} opted out`);
  const created = result.created.length;
  return (
    `Found ${scraped} ${isAgents ? "agents" : "businesses"} in ${where} and added ${created} new ${created === 1 ? LEAD_NOUN[pipelineId].one : LEAD_NOUN[pipelineId].many}` +
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

type FindEmailOutcome =
  | { kind: "found"; email: string; evidence: string | null; blockedReason: string | null }
  | {
      kind: "none";
      routedTo: "cold_call_list" | "contactless_list" | null;
      unverified: { website: string; email: string } | null;
    }
  /** The site couldn't be read; the lead is left as it was and not counted as checked. */
  | { kind: "unreachable"; website: string | null }
  /** The lead already has an address or was pitched, or changed while the lookup ran. */
  | { kind: "refused"; reason: string };

/**
 * After an unreachable site, the bulk sweep leaves the lead alone for this
 * long (so one sweep doesn't keep hammering a site that is down), then
 * tries it again.
 */
export const LOOKUP_RETRY_AFTER_MS = 60 * 60 * 1000;

/**
 * Looks up an address for an existing lead with none and records the
 * result. Only a completed scan with no usable address counts as "checked"
 * and routes a New lead to phone outreach; a site that couldn't be reached
 * leaves the lead as it was, to be tried again later. The address is saved
 * only if the lead still has no address and the same status as when it was
 * read, so it can never replace an address a pitch went to.
 */
export async function findEmailForLead(pipelineId: PipelineId, lead: OutreachLead): Promise<FindEmailOutcome> {
  const pipeline = getPipeline(pipelineId);
  if (lead.email) return { kind: "refused", reason: `${lead.name} already has an address (${lead.email}).` };
  if (lead.lastEmailedAt || (await pipeline.hasBeenEmailed(prisma, lead.id))) {
    return { kind: "refused", reason: `${lead.name} was already emailed, so their address can't be replaced.` };
  }
  const changed: FindEmailOutcome = {
    kind: "refused",
    reason: `${lead.name} changed while the lookup ran — reload the page and try again.`,
  };
  const expected = { status: lead.status, email: null };

  const lookup = await lookupEmail(pipelineId, lead, AbortSignal.timeout(LOOKUP_TIME_LIMIT_MS));
  const checkedAt = new Date();

  if (!lookup.email && lookup.unreachable) {
    await pipeline.updateIfUnchanged(prisma, lead.id, expected, { emailLookupFailedAt: checkedAt });
    return { kind: "unreachable", website: lookup.website ?? lead.website };
  }

  if (!lookup.email) {
    const saved = await pipeline.updateIfUnchanged(prisma, lead.id, expected, {
      website: lookup.website ?? lead.website,
      emailCheckedAt: checkedAt,
      emailLookupFailedAt: null,
    });
    if (!saved) return changed;
    const routedTo = lead.status === "new" ? await routeToPhoneOutreach(pipelineId, lead) : null;
    return { kind: "none", routedTo, unverified: lookup.unverified };
  }

  const conflict = await describeAddressConflict(pipelineId, lookup.email, lead.id);
  const blockedReason = conflict ? `${DUPLICATE_BLOCK_PREFIX} — ${conflict}, so this lead is never auto-sent.` : null;
  const saved = await pipeline.updateIfUnchanged(prisma, lead.id, expected, {
    email: lookup.email,
    emailEvidence: lookup.evidence,
    emailRulesVersion: EMAIL_RULES_VERSION,
    website: lookup.website,
    emailCheckedAt: checkedAt,
    emailLookupFailedAt: null,
    ...(blockedReason ? { sendBlockedReason: blockedReason } : {}),
  });
  if (!saved) return changed;
  return { kind: "found", email: lookup.email, evidence: lookup.evidence, blockedReason };
}

const BULK_FIND_CHUNK_SIZE = 5;
const BULK_FIND_TIME_BUDGET_MS = 20_000;

export type BulkFindResult = { checked: number; found: number; unreachable: number; remaining: number };

/**
 * One chunk of the "Find emails for all leads" sweep: leads never checked
 * before, oldest first, skipping any whose site was unreachable within the
 * last hour. Small and time-boxed so each call stays well under the
 * function limit; the client loops to show live progress.
 */
export async function findEmailsChunk(pipelineId: PipelineId, now: Date = new Date()): Promise<BulkFindResult> {
  const pipeline = getPipeline(pipelineId);
  const retryBefore = new Date(now.getTime() - LOOKUP_RETRY_AFTER_MS);
  const leads = await pipeline.listNeedingEmailLookup(prisma, BULK_FIND_CHUNK_SIZE, retryBefore);
  const deadline = Date.now() + BULK_FIND_TIME_BUDGET_MS;
  let checked = 0;
  let found = 0;
  let unreachable = 0;
  for (const lead of leads) {
    if (checked + unreachable > 0 && Date.now() > deadline) break;
    try {
      const outcome = await findEmailForLead(pipelineId, lead);
      if (outcome.kind === "unreachable") {
        unreachable++;
        continue;
      }
      checked++;
      if (outcome.kind === "found") found++;
      // Refused: it has an address or was emailed after all — nothing to look up.
      if (outcome.kind === "refused") await pipeline.update(prisma, lead.id, { emailCheckedAt: new Date() });
    } catch (err) {
      logError("discovery.findEmailsChunk", err, { pipeline: pipelineId, leadId: lead.id });
      // Park it like an unreachable site so the sweep moves on; it is
      // retried later rather than written off.
      await pipeline.update(prisma, lead.id, { emailLookupFailedAt: new Date() });
      unreachable++;
    }
  }
  const remaining = await pipeline.countNeedingEmailLookup(prisma, retryBefore);
  return { checked, found, unreachable, remaining };
}
