// Validation for the manual "Add lead" / "Add agent" forms. Shared by the
// browser (checks as you type, before submitting) and the server actions
// (the authority), so both give the same message for the same rule.
// Client-safe: no server-only imports.
import { z } from "zod";
import { isValidPhone } from "@/lib/phone";
import { normalizeState } from "@/lib/us-states";
import { SOLD_COUNTIES } from "@/lib/agent-cities";

export const LIMITS = {
  name: 120,
  company: 120,
  email: 254,
  phone: 30,
  address: 200,
  city: 80,
  website: 200,
  source: 120,
  notes: 5_000,
  /** Dollars. */
  estimatedValue: 10_000_000,
} as const;

const optionalText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label} can be at most ${max} characters`);

const optionalEmail = z
  .string()
  .trim()
  .max(LIMITS.email, `Email can be at most ${LIMITS.email} characters`)
  .refine((v) => !v || z.email().safeParse(v).success, "Enter a full email address, like name@business.com");

const optionalPhone = z
  .string()
  .trim()
  .refine((v) => !v || isValidPhone(v), "Phone must be a 10-digit US number, like (480) 555-0101");

const optionalState = z
  .string()
  .trim()
  .refine((v) => !v || normalizeState(v) !== null, "State must be a US state, like AZ or Arizona");

const optionalWebsite = z
  .string()
  .trim()
  .max(LIMITS.website, `Website can be at most ${LIMITS.website} characters`)
  .refine((v) => !v || /^https?:\/\/[^\s.]+\.[^\s]+$/i.test(v) || /^[^\s.]+\.[^\s]+$/.test(v), "Enter a website like example.com");

const name = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(LIMITS.name, `Name can be at most ${LIMITS.name} characters`);

export const coldOutreachLeadSchema = z.object({
  name,
  company: optionalText("Company", LIMITS.company),
  email: optionalEmail,
  phone: optionalPhone,
  address: optionalText("Address", LIMITS.address),
  city: optionalText("City", LIMITS.city),
  state: optionalState,
  website: optionalWebsite,
  source: optionalText("Source", LIMITS.source),
  estimatedValue: z
    .string()
    .trim()
    .refine((v) => !v || /^\$?\s*\d[\d,]*(\.\d{1,2})?$/.test(v), "Estimated value must be a dollar amount of 0 or more, like 2500")
    .refine(
      (v) => !v || parseMoneyToCents(v) <= LIMITS.estimatedValue * 100,
      `Estimated value can be at most $${LIMITS.estimatedValue.toLocaleString("en-US")}`,
    ),
  notes: optionalText("Notes", LIMITS.notes),
});

export const agentLeadSchema = z.object({
  name,
  brokerage: optionalText("Brokerage", LIMITS.company),
  email: optionalEmail,
  phone: optionalPhone,
  city: optionalText("City", LIMITS.city),
  county: z
    .string()
    .trim()
    .refine((v) => !v || SOLD_COUNTIES.some((c) => c.county === v), "County must be one dataleadsell sells: Maricopa, Salt Lake or Utah"),
  website: optionalWebsite,
  notes: optionalText("Notes", LIMITS.notes),
});

/**
 * Notes for an edit: the usual limit applies to what the operator writes,
 * but notes saved before replies and call notes moved to the lead's history
 * may already be longer — those stay editable as long as the notes
 * themselves aren't made longer than they are now.
 */
function editNotes(existing: string | null | undefined) {
  const current = (existing ?? "").trim();
  return z
    .string()
    .trim()
    .refine(
      (v) => v.length <= Math.max(LIMITS.notes, current.length),
      current.length > LIMITS.notes
        ? `Notes can't grow past their current ${current.length.toLocaleString("en-US")} characters — shorten them, or log new details in the lead's history`
        : `Notes can be at most ${LIMITS.notes} characters`,
    );
}

export const coldOutreachLeadEditSchema = (existingNotes: string | null | undefined) =>
  coldOutreachLeadSchema.extend({ notes: editNotes(existingNotes) });
export const agentLeadEditSchema = (existingNotes: string | null | undefined) =>
  agentLeadSchema.extend({ notes: editNotes(existingNotes) });

export type ColdOutreachLeadInput = z.input<typeof coldOutreachLeadSchema>;
export type AgentLeadInput = z.input<typeof agentLeadSchema>;
export type FieldErrors<T> = Partial<Record<keyof T, string>>;

/**
 * "$2,500.5" → 250050 (whole cents), parsed from the digits so no
 * floating-point rounding is involved. Expects a value the schema accepted.
 */
export function parseMoneyToCents(value: string): number {
  const [dollars = "0", fraction = ""] = value.replace(/[$,\s]/g, "").split(".");
  return Number(dollars || "0") * 100 + Number((fraction + "00").slice(0, 2));
}

/** First message per field, keyed by field name. */
export function fieldErrorsOf<T>(error: z.ZodError): FieldErrors<T> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "");
    if (key && !out[key]) out[key] = issue.message;
  }
  return out as FieldErrors<T>;
}

/** Adds https:// to a bare domain. */
export function normalizeWebsite(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

export type FormState<T> = {
  ok?: boolean;
  error?: string;
  fieldErrors?: FieldErrors<T>;
  /** A link shown under a field's error, e.g. to the lead that already has this address. */
  fieldLinks?: Partial<Record<keyof T, { href: string; label: string }>>;
};
