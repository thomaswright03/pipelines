"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { findBusinessesViaYelp } from "@/lib/yelp-discovery";
import { findLicenseesByCounty } from "@/lib/az-adre";
import { findEmailForBusiness } from "@/lib/email-finder";
import { guessWebsiteForBusiness } from "@/lib/website-finder";
import { routeAgentToPhase2 } from "@/lib/dataleadsell-phase-two";
import { sendOutreachEmail } from "@/lib/send-email";
import { isSuppressed, suppressEmail } from "@/lib/email-suppression";
import { buildAgentOutreachEmail } from "@/lib/dataleadsell-email-template";
import { pickNextAgentCity, markAgentCityUsed } from "@/lib/agent-city-picker";
import { withRetry } from "@/lib/with-retry";
import { formatPhone } from "@/lib/phone";
import { DATALEADSELL_SENDER_EMAIL } from "@/lib/dataleadsell-config";

const BUSINESS_TYPE = "real estate agent";
const MAX_PER_RUN = 50;
// Vercel's function timeout is a hard wall — better to stop early and
// return however many leads were found than to blow past it and lose the
// whole run (and any leads already created stay saved either way).
const RUN_TIME_BUDGET_MS = 35 * 1000;

// Only agents/brokers an email was actually found for get saved — a lead
// with no email is useless to this pipeline's email outreach, so it's
// dropped rather than cluttering the table. Neither Yelp nor ADRE gives a
// website directly, so we guess one from the business's name first (see
// website-finder.ts) before trying to find an email on it.
async function dedupeAndCreate(
  candidates: { name: string; phone: string | null; address: string | null; website: string | null }[],
  city: string,
  county: string,
  state: string,
  source: string,
) {
  const existingNames = new Set(
    (await prisma.agentLead.findMany({ select: { name: true } })).map((l) => l.name.trim().toLowerCase()),
  );

  const startedAt = Date.now();
  const created: string[] = [];
  for (const c of candidates) {
    if (created.length >= MAX_PER_RUN) break;
    if (Date.now() - startedAt > RUN_TIME_BUDGET_MS) break;
    const key = c.name.trim().toLowerCase();
    if (!c.name.trim() || existingNames.has(key)) continue;

    const website = c.website ?? (await guessWebsiteForBusiness(c.name));
    const email = await findEmailForBusiness(website);
    if (!email) continue;

    existingNames.add(key);
    const lead = await prisma.agentLead.create({
      data: {
        name: c.name,
        phone: c.phone,
        address: c.address,
        website,
        email,
        city,
        county,
        state,
        source,
        status: "new",
      },
    });
    created.push(lead.id);
  }
  return created;
}

async function dedupeAndCreateAz(candidates: import("@/lib/az-adre").AzLicensee[], county: string, state: string) {
  const existingNames = new Set(
    (await prisma.agentLead.findMany({ select: { name: true } })).map((l) => l.name.trim().toLowerCase()),
  );

  const startedAt = Date.now();
  const created: string[] = [];
  for (const c of candidates) {
    if (created.length >= MAX_PER_RUN) break;
    if (Date.now() - startedAt > RUN_TIME_BUDGET_MS) break;
    const key = c.name.trim().toLowerCase();
    if (!c.name.trim() || existingNames.has(key)) continue;

    const website = await guessWebsiteForBusiness(c.name, c.brokerage);
    const email = await findEmailForBusiness(website);
    if (!email) continue;

    existingNames.add(key);
    const lead = await prisma.agentLead.create({
      data: {
        name: c.name,
        brokerage: c.brokerage,
        phone: c.phone,
        address: c.address,
        city: c.city,
        county,
        state,
        website,
        email,
        source: "Arizona ADRE license roster",
        status: "new",
        notes: `Licensed ${c.licenseType}, active per ADRE.`,
      },
    });
    created.push(lead.id);
  }
  return created;
}

export type MaricopaImportResult = { error?: string; created?: number; matched?: number };

export async function importMaricopaLicenseesAction(): Promise<MaricopaImportResult> {
  let licensees;
  try {
    licensees = await findLicenseesByCounty("Maricopa");
  } catch (err) {
    return { error: err instanceof Error ? err.message : "ADRE download failed" };
  }
  if (licensees.length === 0) {
    return { error: "No active Maricopa County licensees found in ADRE's roster." };
  }

  const created = await dedupeAndCreateAz(licensees, "Maricopa", "AZ");
  revalidatePath("/dataleadsell");
  return { created: created.length, matched: licensees.length };
}

const searchSchema = z.object({
  city: z.string().trim().min(1, "Enter a city"),
  county: z.string().trim().min(1, "Enter a county"),
  state: z.string().trim().min(2, "Enter a state"),
});

export type AgentSearchState = { error?: string; created?: number; scraped?: number };

export async function searchAgentsAction(
  _prevState: AgentSearchState,
  formData: FormData,
): Promise<AgentSearchState> {
  const parsed = searchSchema.safeParse({
    city: String(formData.get("city") ?? ""),
    county: String(formData.get("county") ?? ""),
    state: String(formData.get("state") ?? ""),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  try {
    const results = await findBusinessesViaYelp(BUSINESS_TYPE, `${parsed.data.city}, ${parsed.data.state}`);
    if (results.length === 0) return { error: "No real estate agents found for that city." };

    const created = await dedupeAndCreate(
      results,
      parsed.data.city,
      parsed.data.county,
      parsed.data.state,
      "Yelp search",
    );
    revalidatePath("/dataleadsell");
    return { created: created.length, scraped: results.length };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Search failed" };
  }
}

export type PipelineScrapeResult =
  | { error: string }
  | { city: string; county: string; state: string; created: number; scraped: number };

export async function runAgentPipelineScrapeAction(): Promise<PipelineScrapeResult> {
  const target = await withRetry(() => pickNextAgentCity(prisma));

  let results;
  try {
    results = await findBusinessesViaYelp(BUSINESS_TYPE, `${target.city}, ${target.state}`);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Search failed" };
  }

  await withRetry(() => markAgentCityUsed(prisma, target.city, target.county, target.state));

  const created = await dedupeAndCreate(
    results,
    target.city,
    target.county,
    target.state,
    "Yelp search (Run pipeline button)",
  );

  revalidatePath("/dataleadsell");
  return { city: target.city, county: target.county, state: target.state, created: created.length, scraped: results.length };
}

export async function findAgentEmailAction(
  leadId: string,
): Promise<{ error?: string; email?: string; routedToPhase2?: boolean }> {
  const lead = await prisma.agentLead.findUnique({ where: { id: leadId } });
  if (!lead) return { error: "Lead not found" };

  try {
    const website = lead.website ?? (await guessWebsiteForBusiness(lead.name, lead.brokerage));
    const email = await findEmailForBusiness(website);
    if (!email) {
      await prisma.agentLead.update({ where: { id: leadId }, data: { website, emailCheckedAt: new Date() } });
      if (lead.status === "new") {
        await routeAgentToPhase2(prisma, lead);
        revalidatePath(`/dataleadsell/${leadId}`);
        revalidatePath("/dataleadsell");
        return { error: "No email found on this business's website.", routedToPhase2: true };
      }
      revalidatePath(`/dataleadsell/${leadId}`);
      revalidatePath("/dataleadsell");
      return { error: "No email found on this business's website." };
    }
    await prisma.agentLead.update({ where: { id: leadId }, data: { email, website, emailCheckedAt: new Date() } });
    revalidatePath(`/dataleadsell/${leadId}`);
    revalidatePath("/dataleadsell");
    return { email };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Email search failed" };
  }
}

// Bulk sweep for the "Find emails for all leads" button — same per-lead
// logic as findAgentEmailAction, just looped over every lead that's never
// been checked before (emailCheckedAt is what makes "never checked"
// knowable, so repeat calls move through the backlog instead of retrying
// the same failures). Deliberately processes a small chunk per call rather
// than everything at once: the client calls this repeatedly in a loop to
// show live "checked X of Y" progress between round trips, and it also
// keeps each individual call well under Vercel's function timeout.
const BULK_FIND_TIME_BUDGET_MS = 20 * 1000;
const BULK_FIND_CHUNK_SIZE = 5;

export type BulkFindEmailResult = { checked: number; found: number; remaining: number };

export async function findAllAgentEmailsAction(): Promise<BulkFindEmailResult> {
  const candidates = await prisma.agentLead.findMany({
    where: { email: null, emailCheckedAt: null },
    orderBy: { createdAt: "asc" },
    take: BULK_FIND_CHUNK_SIZE,
  });

  const startedAt = Date.now();
  let checked = 0;
  let found = 0;
  for (const lead of candidates) {
    if (Date.now() - startedAt > BULK_FIND_TIME_BUDGET_MS) break;
    checked++;

    let website: string | null = null;
    let email: string | null = null;
    try {
      website = lead.website ?? (await guessWebsiteForBusiness(lead.name, lead.brokerage));
      email = await findEmailForBusiness(website);
    } catch {
      // treat a failed lookup the same as "not found" — still mark it checked
    }

    if (email) {
      await prisma.agentLead.update({ where: { id: lead.id }, data: { email, website, emailCheckedAt: new Date() } });
      found++;
    } else {
      await prisma.agentLead.update({ where: { id: lead.id }, data: { website, emailCheckedAt: new Date() } });
      if (lead.status === "new") {
        await routeAgentToPhase2(prisma, lead);
      }
    }
  }

  const remaining = await prisma.agentLead.count({ where: { email: null, emailCheckedAt: null } });
  revalidatePath("/dataleadsell");
  return { checked, found, remaining };
}

async function sendOneOutreachEmail(leadId: string): Promise<{ error?: string }> {
  const lead = await prisma.agentLead.findUnique({ where: { id: leadId } });
  if (!lead) return { error: "Lead not found" };
  if (!lead.email) return { error: "Lead has no email" };
  if (await isSuppressed(lead.email)) return { error: "This recipient opted out — not sending." };

  const { subject, body } = buildAgentOutreachEmail(lead.name, lead.county);
  const { providerMessageId } = await sendOutreachEmail(DATALEADSELL_SENDER_EMAIL, lead.email, subject, body);

  await prisma.agentLead.update({
    where: { id: leadId },
    data: { lastEmailedAt: new Date(), status: lead.status === "new" ? "contacted" : lead.status },
  });
  await prisma.emailSendLog.create({ data: { leadId, email: lead.email, providerMessageId } });

  return {};
}

export async function sendOutreachEmailAction(leadId: string): Promise<{ error?: string }> {
  try {
    const result = await sendOneOutreachEmail(leadId);
    revalidatePath(`/dataleadsell/${leadId}`);
    revalidatePath("/dataleadsell");
    return result;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Send failed" };
  }
}

export async function sendAllOutreachEmailsAction(): Promise<{ sent: number; failed: number; errors: string[] }> {
  const candidates = await prisma.agentLead.findMany({
    where: { status: "new", email: { not: null } },
  });

  let sent = 0;
  const errors: string[] = [];
  for (const lead of candidates) {
    try {
      const result = await sendOneOutreachEmail(lead.id);
      if (result.error) errors.push(`${lead.name}: ${result.error}`);
      else sent += 1;
    } catch (err) {
      errors.push(`${lead.name}: ${err instanceof Error ? err.message : "Send failed"}`);
    }
  }

  revalidatePath("/dataleadsell");
  return { sent, failed: errors.length, errors };
}

// Reply detection has no clean cloud equivalent (see send-email.ts) — you
// see the reply in your own inbox, this just records that it happened.
export async function markAgentRepliedAction(leadId: string): Promise<void> {
  const lead = await prisma.agentLead.findUnique({ where: { id: leadId } });
  if (!lead) return;
  await prisma.agentLead.update({
    where: { id: leadId },
    data: { repliedAt: new Date(), status: lead.status === "contacted" ? "responded" : lead.status },
  });
  revalidatePath(`/dataleadsell/${leadId}`);
  revalidatePath("/dataleadsell");
}

// Bounce detection has no webhook wired up yet either (see send-email.ts)
// — this is the honest fallback: you see the bounce notice land in your
// inbox, this records it and marks the lead a dead end the same way an
// automated bounce would.
export async function markAgentBouncedAction(leadId: string): Promise<void> {
  const lead = await prisma.agentLead.findUnique({ where: { id: leadId } });
  if (!lead) return;

  const log = await prisma.emailSendLog.findFirst({ where: { leadId, bounced: false }, orderBy: { sentAt: "desc" } });
  if (log) {
    await prisma.emailSendLog.update({ where: { id: log.id }, data: { bounced: true, bouncedAt: new Date() } });
  }

  if (lead.status !== "subscribed") {
    await prisma.agentLead.update({ where: { id: leadId }, data: { status: "lost" } });
  }
  revalidatePath(`/dataleadsell/${leadId}`);
  revalidatePath("/dataleadsell");
}

// Manual fallback for the automated STOP-detection in /api/email-inbound —
// that route is currently unreachable in production (see README's Known
// limitations), so this is how an opt-out you see in your own inbox
// actually gets enforced today: same suppression list, checked before
// every future send across both pipelines.
export async function markAgentOptedOutAction(leadId: string): Promise<void> {
  const lead = await prisma.agentLead.findUnique({ where: { id: leadId } });
  if (!lead) return;
  if (lead.email) await suppressEmail(lead.email, "Marked opted out manually");
  await prisma.agentLead.update({ where: { id: leadId }, data: { status: "not_interested" } });
  revalidatePath(`/dataleadsell/${leadId}`);
  revalidatePath("/dataleadsell");
}

const agentSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  brokerage: z.string().trim().optional(),
  email: z.string().trim().email().optional().or(z.literal("")),
  phone: z.string().trim().optional(),
  city: z.string().trim().optional(),
  county: z.string().trim().optional(),
  state: z.string().trim().optional(),
  website: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

export type AgentFormState = { error?: string };

export async function createAgentAction(
  _prevState: AgentFormState,
  formData: FormData,
): Promise<AgentFormState> {
  const parsed = agentSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    brokerage: String(formData.get("brokerage") ?? ""),
    email: String(formData.get("email") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    city: String(formData.get("city") ?? ""),
    county: String(formData.get("county") ?? ""),
    state: String(formData.get("state") ?? ""),
    website: String(formData.get("website") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  await prisma.agentLead.create({
    data: {
      name: parsed.data.name,
      brokerage: parsed.data.brokerage || null,
      email: parsed.data.email || null,
      phone: parsed.data.phone ? formatPhone(parsed.data.phone) : null,
      city: parsed.data.city || null,
      county: parsed.data.county || null,
      state: parsed.data.state || null,
      website: parsed.data.website || null,
      notes: parsed.data.notes || null,
      source: "Manual entry",
    },
  });

  revalidatePath("/dataleadsell");
  return {};
}

export async function updateAgentStatusAction(leadId: string, status: string): Promise<void> {
  await prisma.agentLead.update({ where: { id: leadId }, data: { status } });
  revalidatePath(`/dataleadsell/${leadId}`);
  revalidatePath("/dataleadsell");
}

export async function toggleAgentStarAction(leadId: string): Promise<void> {
  const lead = await prisma.agentLead.findUnique({ where: { id: leadId } });
  if (!lead) return;
  await prisma.agentLead.update({ where: { id: leadId }, data: { starred: !lead.starred } });
  revalidatePath(`/dataleadsell/${leadId}`);
  revalidatePath("/dataleadsell");
}
