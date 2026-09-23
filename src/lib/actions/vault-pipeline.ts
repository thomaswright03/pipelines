"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { digitsOnly, formatPhone } from "@/lib/phone";
import { findEmailForBusiness } from "@/lib/email-finder";
import { guessWebsiteForBusiness } from "@/lib/website-finder";
import { revealLatestMessageInMailApp } from "@/lib/mail-app";
import { sendOutreachEmail } from "@/lib/send-email";
import { isSuppressed, suppressEmail } from "@/lib/email-suppression";
import { buildOutreachEmail, OUTREACH_MAILING_ADDRESS } from "@/lib/vault-email-template";
import { routeLeadToPhase2 } from "@/lib/vault-phase-two";
import { findBusinessesViaYelp } from "@/lib/yelp-discovery";
import { pickNextCity, markCityUsed } from "@/lib/vault-city-picker";
import { withRetry } from "@/lib/with-retry";
import { VAULT_PIPELINE_SENDER_EMAIL } from "@/lib/vault-config";

const BASE_PATH = "/vault-pipeline";

function revalidate(leadId?: string) {
  revalidatePath(BASE_PATH);
  if (leadId) revalidatePath(`${BASE_PATH}/${leadId}`);
}

// --- Manual CRUD ---

export type LeadFormState = { error?: string };

const leadSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  company: z.string().trim().optional(),
  email: z.string().trim().email().optional().or(z.literal("")),
  phone: z
    .string()
    .trim()
    .optional()
    .refine((val) => !val || digitsOnly(val).length === 10, "Phone must be 10 digits"),
  address: z.string().trim().optional(),
  city: z.string().trim().optional(),
  state: z.string().trim().optional(),
  website: z.string().trim().optional(),
  source: z.string().trim().optional(),
  estimatedValue: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

function readLeadFields(formData: FormData) {
  return {
    name: String(formData.get("name") ?? ""),
    company: String(formData.get("company") ?? ""),
    email: String(formData.get("email") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    address: String(formData.get("address") ?? ""),
    city: String(formData.get("city") ?? ""),
    state: String(formData.get("state") ?? ""),
    website: String(formData.get("website") ?? ""),
    source: String(formData.get("source") ?? ""),
    estimatedValue: String(formData.get("estimatedValue") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  };
}

export async function createLeadAction(
  _prevState: LeadFormState,
  formData: FormData,
): Promise<LeadFormState> {
  const parsed = leadSchema.safeParse(readLeadFields(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const estimatedValue = parsed.data.estimatedValue ? Number(parsed.data.estimatedValue) : null;
  if (parsed.data.estimatedValue && Number.isNaN(estimatedValue)) {
    return { error: "Estimated value must be a number" };
  }

  await prisma.lead.create({
    data: {
      name: parsed.data.name,
      company: parsed.data.company || null,
      email: parsed.data.email || null,
      phone: parsed.data.phone ? formatPhone(parsed.data.phone) : null,
      address: parsed.data.address || null,
      city: parsed.data.city || null,
      state: parsed.data.state || null,
      website: parsed.data.website || null,
      source: parsed.data.source || "Manual entry",
      estimatedValue,
      notes: parsed.data.notes || null,
    },
  });

  revalidate();
  return {};
}

// --- Discovery ---

export type LeadSearchState = { error?: string; created?: number; scraped?: number };
const MAX_PER_RUN = 50;

// Vercel's function timeout is a hard wall — better to stop early and
// return however many leads were found than to blow past it and lose the
// whole run (and any leads already created stay saved either way).
const RUN_TIME_BUDGET_MS = 35 * 1000;

// Only businesses an email was actually found for get saved — same rule as
// dataleadsell.ts. Yelp never returns a website (see yelp-discovery.ts), so
// we guess one from the business's name first (see website-finder.ts)
// before trying to find an email on it.
async function dedupeAndCreate(
  candidates: { name: string; phone: string | null; address: string | null; website: string | null }[],
  city: string,
  state: string,
  source: string,
) {
  const existingNames = new Set(
    (await prisma.lead.findMany({ select: { name: true } })).map((l) => l.name.trim().toLowerCase()),
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
    const lead = await prisma.lead.create({
      data: { name: c.name, phone: c.phone, address: c.address, website, email, city, state, source, status: "new" },
    });
    created.push(lead.id);
  }
  return created;
}

const searchSchema = z.object({
  city: z.string().trim().min(1, "Enter a city"),
  state: z.string().trim().min(2, "Enter a state"),
  businessType: z.string().trim().optional(),
});

export async function searchLeadsAction(
  _prevState: LeadSearchState,
  formData: FormData,
): Promise<LeadSearchState> {
  const parsed = searchSchema.safeParse({
    city: String(formData.get("city") ?? ""),
    state: String(formData.get("state") ?? ""),
    businessType: String(formData.get("businessType") ?? ""),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  try {
    const results = await findBusinessesViaYelp(parsed.data.businessType ?? "", `${parsed.data.city}, ${parsed.data.state}`);
    if (results.length === 0) return { error: "No businesses found for that city." };

    const created = await dedupeAndCreate(results, parsed.data.city, parsed.data.state, "Yelp search");
    revalidate();
    return { created: created.length, scraped: results.length };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Search failed" };
  }
}

export type PipelineScrapeResult =
  | { error: string }
  | { city: string; state: string; created: number; scraped: number };

export async function runPipelineScrapeAction(): Promise<PipelineScrapeResult> {
  const target = await withRetry(() => pickNextCity(prisma));

  let results;
  try {
    results = await findBusinessesViaYelp("", `${target.city}, ${target.state}`);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Search failed" };
  }
  await withRetry(() => markCityUsed(prisma, target.city, target.state));

  const created = await dedupeAndCreate(results, target.city, target.state, "Yelp search (Run pipeline button)");
  revalidate();
  return { city: target.city, state: target.state, created: created.length, scraped: results.length };
}

// --- Contact finding ---

export async function findLeadEmailAction(
  leadId: string,
): Promise<{ error?: string; email?: string; routedToPhase2?: boolean }> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { error: "Lead not found" };

  try {
    const website = lead.website ?? (await guessWebsiteForBusiness(lead.name));
    const email = await findEmailForBusiness(website);
    if (!email) {
      await prisma.lead.update({ where: { id: leadId }, data: { website, emailCheckedAt: new Date() } });
      if (lead.status === "new") {
        await routeLeadToPhase2(prisma, lead);
        revalidate(leadId);
        return { error: "Couldn't find an email on this business's website.", routedToPhase2: true };
      }
      revalidate(leadId);
      return { error: "Couldn't find an email on this business's website." };
    }
    await prisma.lead.update({ where: { id: leadId }, data: { email, website, emailCheckedAt: new Date() } });
    revalidate(leadId);
    return { email };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Email search failed" };
  }
}

// Bulk sweep for the "Find emails for all leads" button — same per-lead
// logic as findLeadEmailAction, just looped over every lead that's never
// been checked before (emailCheckedAt is what makes "never checked"
// knowable, so repeat calls move through the backlog instead of retrying
// the same failures). Deliberately processes a small chunk per call rather
// than everything at once: the client calls this repeatedly in a loop to
// show live "checked X of Y" progress between round trips, and it also
// keeps each individual call well under Vercel's function timeout.
const BULK_FIND_TIME_BUDGET_MS = 20 * 1000;
const BULK_FIND_CHUNK_SIZE = 5;

export type BulkFindEmailResult = { checked: number; found: number; remaining: number };

export async function findAllLeadEmailsAction(): Promise<BulkFindEmailResult> {
  const candidates = await prisma.lead.findMany({
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
      website = lead.website ?? (await guessWebsiteForBusiness(lead.name));
      email = await findEmailForBusiness(website);
    } catch {
      // treat a failed lookup the same as "not found" — still mark it checked
    }

    if (email) {
      await prisma.lead.update({ where: { id: lead.id }, data: { email, website, emailCheckedAt: new Date() } });
      found++;
    } else {
      await prisma.lead.update({ where: { id: lead.id }, data: { website, emailCheckedAt: new Date() } });
      if (lead.status === "new") {
        await routeLeadToPhase2(prisma, lead);
      }
    }
  }

  const remaining = await prisma.lead.count({ where: { email: null, emailCheckedAt: null } });
  revalidate();
  return { checked, found, remaining };
}

// --- Sending ---

export async function markLeadEmailedAction(leadId: string): Promise<void> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return;
  await prisma.lead.update({
    where: { id: leadId },
    data: { lastEmailedAt: new Date(), repliedAt: null, status: lead.status === "new" ? "contacted" : lead.status },
  });
  revalidate(leadId);
}

async function sendOneOutreachEmail(leadId: string): Promise<{ error?: string }> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { error: "Lead not found" };
  if (!lead.email) return { error: "Lead has no email" };
  if (await isSuppressed(lead.email)) return { error: "This recipient opted out — not sending." };

  const { subject, body } = buildOutreachEmail(lead.company || lead.name);
  const { providerMessageId } = await sendOutreachEmail(VAULT_PIPELINE_SENDER_EMAIL, lead.email, subject, body);

  await prisma.lead.update({
    where: { id: leadId },
    data: { lastEmailedAt: new Date(), repliedAt: null, status: lead.status === "new" ? "contacted" : lead.status },
  });
  await prisma.leadEmailSendLog.create({ data: { leadId, email: lead.email, providerMessageId } });

  return {};
}

export async function sendOutreachEmailAction(leadId: string): Promise<{ error?: string }> {
  try {
    const result = await sendOneOutreachEmail(leadId);
    revalidate(leadId);
    return result;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Send failed" };
  }
}

const MAX_SENDS_PER_RUN = 50;
const SEND_DELAY_MS = 1000;

export type SendAllResult = { sent: number; failed: number; errors: string[] };

export async function sendAllOutreachEmailsAction(): Promise<SendAllResult> {
  if (OUTREACH_MAILING_ADDRESS.startsWith("[")) {
    return {
      sent: 0,
      failed: 0,
      errors: ["Add a real mailing address to vault-email-template.ts before auto-sending — CAN-SPAM requires one, and there's no draft review step here."],
    };
  }

  const candidates = await prisma.lead.findMany({
    where: { email: { not: null }, lastEmailedAt: null, status: "new" },
    orderBy: { createdAt: "asc" },
    take: MAX_SENDS_PER_RUN,
  });

  let sent = 0;
  const errors: string[] = [];
  for (const lead of candidates) {
    try {
      const result = await sendOneOutreachEmail(lead.id);
      if (result.error) errors.push(`${lead.name}: ${result.error}`);
      else sent += 1;
    } catch (err) {
      errors.push(`${lead.name}: ${err instanceof Error ? err.message : "unknown error"}`);
    }
    await new Promise((resolve) => setTimeout(resolve, SEND_DELAY_MS));
  }

  revalidate();
  return { sent, failed: errors.length, errors };
}

// --- Reply / bounce ---

// Neither reply nor bounce detection is automated right now (see
// send-email.ts — no webhook wired up for ZeptoMail yet) — both of these
// just record what a human saw happen in their own inbox.
export async function markLeadRepliedAction(leadId: string): Promise<void> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return;
  if (lead.status !== "contacted") return; // never move a lead backward/sideways
  await prisma.lead.update({ where: { id: leadId }, data: { repliedAt: new Date(), status: "responded" } });
  revalidate(leadId);
}

export async function markLeadBouncedAction(leadId: string): Promise<void> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return;

  const log = await prisma.leadEmailSendLog.findFirst({ where: { leadId, bounced: false }, orderBy: { sentAt: "desc" } });
  if (log) {
    await prisma.leadEmailSendLog.update({ where: { id: log.id }, data: { bounced: true, bouncedAt: new Date() } });
  }

  if (lead.status !== "paying_client") {
    await prisma.lead.update({ where: { id: leadId }, data: { status: "lost", callOutcome: "unable_to_contact" } });
  }
  revalidate(leadId);
}

// Manual fallback for the automated STOP-detection in /api/email-inbound —
// that route is currently unreachable in production (see README's Known
// limitations), so this is how an opt-out you see in your own inbox
// actually gets enforced today: same suppression list, checked before
// every future send across both pipelines.
export async function markLeadOptedOutAction(leadId: string): Promise<void> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return;
  if (lead.email) await suppressEmail(lead.email, "Marked opted out manually");
  await prisma.lead.update({ where: { id: leadId }, data: { status: "lost" } });
  revalidate(leadId);
}

export async function viewLeadEmailThreadAction(email: string): Promise<{ found: boolean }> {
  return { found: await revealLatestMessageInMailApp(VAULT_PIPELINE_SENDER_EMAIL, email) };
}

// Corrects a false positive from a manual "mark replied": it was actually
// a non-delivery notice you saw and mistook for a real reply.
export async function markResponseAsNonDeliveryAction(leadId: string): Promise<void> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return;

  const log = await prisma.leadEmailSendLog.findFirst({ where: { leadId, bounced: false }, orderBy: { sentAt: "desc" } });
  if (log) {
    await prisma.leadEmailSendLog.update({
      where: { id: log.id },
      data: { bounced: true, bouncedAt: lead.repliedAt ?? new Date() },
    });
  }

  await prisma.lead.update({ where: { id: leadId }, data: { repliedAt: null, ourReplyAt: null } });
  await routeLeadToPhase2(prisma, lead);
  revalidate(leadId);
}

// --- Status transitions ---

export async function updateLeadStatusAction(leadId: string, status: string): Promise<void> {
  await prisma.lead.update({ where: { id: leadId }, data: { status } });
  revalidate(leadId);
}

export async function setLeadStarredAction(leadId: string, starred: boolean): Promise<void> {
  await prisma.lead.update({ where: { id: leadId }, data: { starred } });
  revalidate(leadId);
}

export async function setOurReplyAction(leadId: string, replied: boolean): Promise<void> {
  await prisma.lead.update({ where: { id: leadId }, data: { ourReplyAt: replied ? new Date() : null } });
  revalidate(leadId);
}

export async function scheduleAppointmentAction(leadId: string, appointmentAt: string): Promise<{ error?: string }> {
  const date = new Date(appointmentAt);
  if (Number.isNaN(date.getTime())) return { error: "Invalid appointment date" };
  await prisma.lead.update({ where: { id: leadId }, data: { appointmentAt: date, status: "appointment_set" } });
  revalidate(leadId);
  return {};
}

// Manual, simplified from Vault's own version: bizhub auto-advances
// appointment_set -> working_for when the first Project is created for the
// converted Client. This pipeline has no Client/Project system (out of
// scope — see LEAD_GEN_PIPELINE_SPEC.md §1), so these are plain manual
// buttons instead of that automatic trigger.
export async function markWorkingForAction(leadId: string): Promise<void> {
  await prisma.lead.update({ where: { id: leadId }, data: { status: "working_for" } });
  revalidate(leadId);
}

export async function markPayingClientAction(leadId: string): Promise<void> {
  await prisma.lead.update({ where: { id: leadId }, data: { status: "paying_client" } });
  revalidate(leadId);
}

const LOST_REASONS = ["not_interested", "too_busy", "no_answer", "no_need", "unable_to_contact"] as const;

export async function markLeadLostAction(leadId: string, reason: (typeof LOST_REASONS)[number]): Promise<void> {
  if (!LOST_REASONS.includes(reason)) throw new Error("Invalid reason");
  await prisma.lead.update({ where: { id: leadId }, data: { status: "lost", callOutcome: reason } });
  revalidate(leadId);
}

// --- Cold call flashcards ---

const COLD_CALL_OUTCOMES = ["no_answer", "invalid_number", "not_interested", "interested"] as const;
export type ColdCallOutcome = (typeof COLD_CALL_OUTCOMES)[number];

const COLD_CALL_RESULT: Record<ColdCallOutcome, { callOutcome: string; status?: string }> = {
  no_answer: { callOutcome: "no_answer" },
  invalid_number: { callOutcome: "unable_to_contact", status: "lost" },
  not_interested: { callOutcome: "not_interested", status: "lost" },
  interested: { callOutcome: "interested", status: "responded" },
};

export async function confirmColdCallAction(leadId: string, outcome: ColdCallOutcome, notes: string): Promise<void> {
  if (!COLD_CALL_OUTCOMES.includes(outcome)) throw new Error("Invalid outcome");

  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) throw new Error("Lead not found");

  const trimmedNotes = notes.trim();
  const stamp = `[Cold call ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}]`;
  const newNoteLine = trimmedNotes ? `${stamp}: ${trimmedNotes}` : null;
  const combinedNotes = [lead.notes, newNoteLine].filter(Boolean).join("\n\n") || null;

  const result = COLD_CALL_RESULT[outcome];
  await prisma.lead.update({
    where: { id: leadId },
    data: { callOutcome: result.callOutcome, ...(result.status ? { status: result.status } : {}), notes: combinedNotes },
  });

  revalidate(leadId);
}

// --- Activity log ---

export async function addLeadActivityAction(leadId: string, type: string, notes: string): Promise<void> {
  const trimmed = notes.trim();
  if (!trimmed) return;
  await prisma.leadActivity.create({ data: { leadId, type, notes: trimmed } });
  revalidate(leadId);
}
