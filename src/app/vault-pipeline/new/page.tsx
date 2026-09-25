"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createLeadAction } from "@/lib/actions/vault-pipeline";
import { coldOutreachLeadSchema, LIMITS, type ColdOutreachLeadInput } from "@/lib/lead-forms";
import { US_STATE_OPTIONS } from "@/lib/us-states";
import { TextAreaField, TextField, useLeadForm } from "@/components/LeadFormFields";

const EMPTY: Required<ColdOutreachLeadInput> = {
  name: "",
  company: "",
  email: "",
  phone: "",
  address: "",
  city: "",
  state: "",
  website: "",
  source: "",
  estimatedValue: "",
  notes: "",
};

export default function NewLead() {
  const router = useRouter();
  const form = useLeadForm(coldOutreachLeadSchema, EMPTY, createLeadAction, (id) => router.push(`/vault-pipeline/${id}`));
  const state = form.field("state");

  return (
    <div className="mx-auto w-full max-w-lg">
      <Link href="/vault-pipeline" className="text-sm font-medium text-indigo-700 hover:text-indigo-600 dark:text-indigo-300">
        ← All leads
      </Link>
      <h1 className="accent-text mt-1 text-2xl font-bold tracking-tight">Add lead</h1>
      <form onSubmit={form.onSubmit} noValidate className="card mt-4 flex flex-col gap-3 p-5">
        <TextField label="Name" required maxLength={LIMITS.name} autoComplete="off" {...form.field("name")} />
        <TextField label="Company" maxLength={LIMITS.company} {...form.field("company")} />
        <TextField
          label="Email"
          type="email"
          maxLength={LIMITS.email}
          hint="Leave blank and use “Find email” on the lead page to look one up."
          {...form.field("email")}
        />
        <TextField label="Phone" type="tel" inputMode="tel" placeholder="(480) 555-0101" {...form.field("phone")} />
        <TextField label="Address" maxLength={LIMITS.address} {...form.field("address")} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField label="City" maxLength={LIMITS.city} {...form.field("city")} />
          <div className="flex flex-col gap-1">
            <label htmlFor="field-state" className="field-label">
              State
            </label>
            <select
              id="field-state"
              name="state"
              value={state.value}
              onChange={(e) => state.onChange(e.target.value)}
              onBlur={state.onBlur}
              aria-invalid={state.error ? true : undefined}
              className="input"
            >
              <option value="">—</option>
              {US_STATE_OPTIONS.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
            {state.error && <p className="field-error">{state.error}</p>}
          </div>
        </div>
        <TextField label="Website" placeholder="example.com" maxLength={LIMITS.website} {...form.field("website")} />
        <TextField label="Source" placeholder="Referral, event, …" maxLength={LIMITS.source} {...form.field("source")} />
        <TextField label="Estimated value ($)" inputMode="decimal" placeholder="2500" {...form.field("estimatedValue")} />
        <TextAreaField label="Notes" maxLength={LIMITS.notes} {...form.field("notes")} />
        <div aria-live="polite">{form.formError && <p className="notice-error">{form.formError}</p>}</div>
        <button type="submit" disabled={form.isPending} className="btn-primary">
          {form.isPending ? "Saving…" : "Add lead"}
        </button>
      </form>
    </div>
  );
}
