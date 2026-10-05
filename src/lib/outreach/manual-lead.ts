// Adding and editing a lead by hand, the same way in every pipeline:
// validate the form, normalise it, check the address, then create or save,
// and say what went wrong in the form's own words. Each pipeline's actions
// file (src/lib/actions/*.ts) supplies only what is its own: the form's
// schemas, how the fields map to its table's columns, and the insert.
//
// A new address is checked and inserted under the address's lock
// (address-lock.ts), so two tabs adding the same address can't both pass
// the "already used" check: the second gets the same field error as a
// sequential duplicate.
import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { failureMessage } from "@/lib/db-health";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/log";
import {
  fieldErrorsOf,
  normalizeWebsite,
  parseMoneyToCents,
  type AgentLeadInput,
  type ColdOutreachLeadInput,
  type FormState,
} from "@/lib/lead-forms";
import { stateForCounty } from "@/lib/agent-cities";
import { normalizePhone } from "@/lib/phone";
import { normalizeState } from "@/lib/us-states";
import { lockAddress } from "@/lib/outreach/address-lock";
import { enteredByHandEvidence } from "@/lib/outreach/evidence";
import { checkAddressForLead, editLead } from "@/lib/outreach/lead-edit";
import { PIPELINE_BASE_PATH, type PipelineId } from "@/lib/outreach/pipeline-id";
import type { Db } from "@/lib/outreach/pipelines";

export type LeadFormState<I> = FormState<I> & { leadId?: string };

type Parsed = { email?: string; notes?: string };

export type ManualLeadSpec<I, P extends Parsed> = {
  pipeline: PipelineId;
  /** The "Add" form's schema, and the edit form's (which allows notes already longer than the limit). */
  createSchema: z.ZodType<P, I>;
  editSchema: (existingNotes: string | null | undefined) => z.ZodType<P, I>;
  /** The form's fields as the table's columns (not the address, which is handled here). */
  columns: (data: P) => Record<string, unknown>;
  /** Inserts a new row with `data` (columns, address and its evidence). */
  insert: (db: Db, data: Record<string, unknown>) => Promise<{ id: string }>;
  /** The lead's current notes, for the edit schema. */
  currentNotes: (db: Db, leadId: string) => Promise<string | null | undefined>;
  /** Server-log scopes, e.g. "action.createLead". */
  logScopes: { create: string; update: string };
};

/** The business form's fields (Cold Outreach and Garbage AI) as Lead / HaulerLead columns. */
export function businessLeadColumns(d: ColdOutreachLeadInput & { name: string }) {
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

/** The agent form's fields (dataleadsell) as AgentLead columns. */
export function agentLeadColumns(d: AgentLeadInput & { name: string }) {
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

const UNEXPECTED = "Something went wrong saving that — nothing was changed. Try again in a moment.";

function revalidate(pipeline: PipelineId, leadId?: string) {
  const base = PIPELINE_BASE_PATH[pipeline];
  revalidatePath(base);
  revalidatePath(`${base}/stats`);
  if (leadId) revalidatePath(`${base}/${leadId}`);
}

function invalid<I>(error: z.ZodError): LeadFormState<I> {
  return { error: "Fix the highlighted fields.", fieldErrors: fieldErrorsOf<I>(error) };
}

function addressRefused<I>(message: string, link: { href: string; label: string } | null | undefined): LeadFormState<I> {
  return {
    error: "This email can't be used.",
    fieldErrors: { email: message } as LeadFormState<I>["fieldErrors"],
    ...(link ? { fieldLinks: { email: link } as LeadFormState<I>["fieldLinks"] } : {}),
  };
}

/** Adds a lead from the "Add" form. */
export async function createManualLead<I, P extends Parsed>(spec: ManualLeadSpec<I, P>, input: I): Promise<LeadFormState<I>> {
  const parsed = spec.createSchema.safeParse(input);
  if (!parsed.success) return invalid<I>(parsed.error);
  const d = parsed.data;
  const email = d.email ? d.email.trim().toLowerCase() : null;
  const data = { ...spec.columns(d), email, emailEvidence: email ? enteredByHandEvidence() : null };
  try {
    type Outcome = { ok: true; leadId: string } | { ok: false; message: string; link: { href: string; label: string } | null };
    const outcome: Outcome = email
      ? await prisma.$transaction(async (tx): Promise<Outcome> => {
          await lockAddress(tx, email);
          const problem = await checkAddressForLead(spec.pipeline, email, undefined, tx);
          if (problem) return { ok: false, ...problem };
          return { ok: true, leadId: (await spec.insert(tx, data)).id };
        })
      : { ok: true, leadId: (await spec.insert(prisma, data)).id };
    if (!outcome.ok) return addressRefused<I>(outcome.message, outcome.link);
    revalidate(spec.pipeline);
    return { ok: true, leadId: outcome.leadId };
  } catch (err) {
    logError(spec.logScopes.create, err);
    return { error: failureMessage(err, UNEXPECTED) };
  }
}

/** Saves the "Edit details" form. */
export async function updateManualLead<I, P extends Parsed>(
  spec: ManualLeadSpec<I, P>,
  leadId: string,
  input: I,
): Promise<LeadFormState<I>> {
  const notes = await spec.currentNotes(prisma, leadId).catch(() => null);
  const parsed = spec.editSchema(notes).safeParse(input);
  if (!parsed.success) return invalid<I>(parsed.error);
  const d = parsed.data;
  try {
    const outcome = await editLead(spec.pipeline, leadId, d.email || null, spec.columns(d));
    if (!outcome.ok) {
      if (outcome.field !== "email") return { error: outcome.error };
      return addressRefused<I>(outcome.error, outcome.link);
    }
    revalidate(spec.pipeline, leadId);
    return { ok: true, leadId };
  } catch (err) {
    logError(spec.logScopes.update, err, { leadId });
    return { error: failureMessage(err, UNEXPECTED) };
  }
}
