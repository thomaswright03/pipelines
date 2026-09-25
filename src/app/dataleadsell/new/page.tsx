"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createAgentAction } from "@/lib/actions/dataleadsell";
import { agentLeadSchema, LIMITS, type AgentLeadInput } from "@/lib/lead-forms";
import { SOLD_COUNTIES, citiesInCounty } from "@/lib/agent-cities";
import { TextAreaField, TextField, useLeadForm } from "@/components/LeadFormFields";

const EMPTY: Required<AgentLeadInput> = {
  name: "",
  brokerage: "",
  email: "",
  phone: "",
  city: "",
  county: "",
  website: "",
  notes: "",
};

export default function NewAgentLead() {
  const router = useRouter();
  const form = useLeadForm(agentLeadSchema, EMPTY, createAgentAction, (id) => router.push(`/dataleadsell/${id}`));
  const county = form.field("county");
  const cities = county.value ? citiesInCounty(county.value) : [];

  return (
    <div className="mx-auto w-full max-w-lg">
      <Link href="/dataleadsell" className="text-sm font-medium text-indigo-700 hover:text-indigo-600 dark:text-indigo-300">
        ← All agents
      </Link>
      <h1 className="accent-text mt-1 text-2xl font-bold tracking-tight">Add agent</h1>
      <form onSubmit={form.onSubmit} noValidate className="card mt-4 flex flex-col gap-3 p-5">
        <TextField label="Name" required maxLength={LIMITS.name} autoComplete="off" {...form.field("name")} />
        <TextField label="Brokerage" maxLength={LIMITS.company} {...form.field("brokerage")} />
        <TextField
          label="Email"
          type="email"
          maxLength={LIMITS.email}
          hint="The agent's own address — not the brokerage's shared inbox."
          {...form.field("email")}
        />
        <TextField label="Phone" type="tel" inputMode="tel" placeholder="(480) 555-0101" {...form.field("phone")} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="field-county" className="field-label">
              County
            </label>
            <select
              id="field-county"
              name="county"
              value={county.value}
              onChange={(e) => {
                county.onChange(e.target.value);
                form.set("city", "");
              }}
              onBlur={county.onBlur}
              aria-invalid={county.error ? true : undefined}
              className="input"
            >
              <option value="">—</option>
              {SOLD_COUNTIES.map((c) => (
                <option key={c.county} value={c.county}>
                  {c.county} County, {c.state}
                </option>
              ))}
            </select>
            {county.error && <p className="field-error">{county.error}</p>}
          </div>
          {cities.length > 0 ? (
            <div className="flex flex-col gap-1">
              <label htmlFor="field-city" className="field-label">
                City
              </label>
              <select
                id="field-city"
                name="city"
                value={form.values.city}
                onChange={(e) => form.set("city", e.target.value)}
                className="input"
              >
                <option value="">—</option>
                {cities.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <TextField label="City" maxLength={LIMITS.city} {...form.field("city")} />
          )}
        </div>
        <TextField label="Website" placeholder="example.com" maxLength={LIMITS.website} {...form.field("website")} />
        <TextAreaField label="Notes" maxLength={LIMITS.notes} {...form.field("notes")} />
        <div aria-live="polite">{form.formError && <p className="notice-error">{form.formError}</p>}</div>
        <button type="submit" disabled={form.isPending} className="btn-primary">
          {form.isPending ? "Saving…" : "Add agent"}
        </button>
      </form>
    </div>
  );
}
