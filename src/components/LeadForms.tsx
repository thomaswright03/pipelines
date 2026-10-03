"use client";

// The add/edit forms for every pipeline. Adding and editing share one form
// per pipeline, so both apply exactly the same rules and messages.
import { useRouter } from "next/navigation";
import { createLeadAction, updateLeadAction } from "@/lib/actions/vault-pipeline";
import { createAgentAction, updateAgentAction } from "@/lib/actions/dataleadsell";
import { createHaulerAction, updateHaulerAction } from "@/lib/actions/garbage-ai";
import {
  agentLeadEditSchema,
  agentLeadSchema,
  coldOutreachLeadEditSchema,
  coldOutreachLeadSchema,
  LIMITS,
  type AgentLeadInput,
  type ColdOutreachLeadInput,
} from "@/lib/lead-forms";
import { US_STATE_OPTIONS } from "@/lib/us-states";
import { SOLD_COUNTIES, citiesInCounty } from "@/lib/agent-cities";
import { TextAreaField, TextField, useLeadForm } from "@/components/LeadFormFields";

export const EMPTY_COLD_OUTREACH_LEAD: Required<ColdOutreachLeadInput> = {
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

export const EMPTY_AGENT_LEAD: Required<AgentLeadInput> = {
  name: "",
  brokerage: "",
  email: "",
  phone: "",
  city: "",
  county: "",
  website: "",
  notes: "",
};

type Mode = { kind: "create" } | { kind: "edit"; leadId: string; emailLocked: string | null };

function EmailLockedNote({ email }: { email: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="field-label">Email</span>
      <p className="text-sm">
        {email} <span className="muted">— already emailed, so the address can&apos;t be changed.</span>
      </p>
    </div>
  );
}

/** The Cold Outreach form; Garbage AI haulers (`haulers`) have the same fields. */
export function ColdOutreachLeadForm({
  mode,
  initial,
  haulers = false,
}: {
  mode: Mode;
  initial: Required<ColdOutreachLeadInput>;
  haulers?: boolean;
}) {
  const router = useRouter();
  const [create, update] = haulers ? [createHaulerAction, updateHaulerAction] : [createLeadAction, updateLeadAction];
  const submit = mode.kind === "edit" ? (values: ColdOutreachLeadInput) => update(mode.leadId, values) : create;
  const schema = mode.kind === "edit" ? coldOutreachLeadEditSchema(initial.notes) : coldOutreachLeadSchema;
  const form = useLeadForm(schema, initial, submit, (id) => {
    router.push(`${haulers ? "/garbage-ai" : "/vault-pipeline"}/${id}`);
    router.refresh();
  });
  const state = form.field("state");
  const locked = mode.kind === "edit" ? mode.emailLocked : null;

  return (
    <form onSubmit={form.onSubmit} noValidate className="card mt-4 flex flex-col gap-3 p-5">
      {form.guardDialog}
      <TextField label="Name" required limit={LIMITS.name} autoComplete="off" {...form.field("name")} />
      <TextField label="Company" limit={LIMITS.company} {...form.field("company")} />
      {locked ? (
        <EmailLockedNote email={locked} />
      ) : (
        <TextField
          label="Email"
          type="email"
          limit={LIMITS.email}
          hint={mode.kind === "create" ? "Leave blank and use “Find email” on the lead page to look one up." : undefined}
          {...form.field("email")}
        />
      )}
      <TextField label="Phone" type="tel" inputMode="tel" placeholder="(480) 555-0101" {...form.field("phone")} />
      <TextField label="Address" limit={LIMITS.address} {...form.field("address")} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextField label="City" limit={LIMITS.city} {...form.field("city")} />
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
      <TextField label="Website" placeholder="example.com" limit={LIMITS.website} {...form.field("website")} />
      <TextField label="Source" placeholder="Referral, event, …" limit={LIMITS.source} {...form.field("source")} />
      <TextField label="Estimated value ($)" inputMode="decimal" placeholder="2500" {...form.field("estimatedValue")} />
      <TextAreaField label="Notes" limit={Math.max(LIMITS.notes, initial.notes.length)} {...form.field("notes")} />
      <div aria-live="polite">{form.formError && <p className="notice-error">{form.formError}</p>}</div>
      <button type="submit" disabled={form.isPending} className="btn-primary">
        {form.isPending ? "Saving…" : mode.kind === "edit" ? "Save changes" : "Add lead"}
      </button>
    </form>
  );
}

export function AgentLeadForm({ mode, initial }: { mode: Mode; initial: Required<AgentLeadInput> }) {
  const router = useRouter();
  const submit = mode.kind === "edit" ? (values: AgentLeadInput) => updateAgentAction(mode.leadId, values) : createAgentAction;
  const schema = mode.kind === "edit" ? agentLeadEditSchema(initial.notes) : agentLeadSchema;
  const form = useLeadForm(schema, initial, submit, (id) => {
    router.push(`/dataleadsell/${id}`);
    router.refresh();
  });
  const county = form.field("county");
  const cities = county.value ? citiesInCounty(county.value) : [];
  // Keep a city that isn't in the county's list (e.g. from ADRE) selectable.
  const cityOptions = form.values.city && !cities.includes(form.values.city) ? [form.values.city, ...cities] : cities;
  const locked = mode.kind === "edit" ? mode.emailLocked : null;

  return (
    <form onSubmit={form.onSubmit} noValidate className="card mt-4 flex flex-col gap-3 p-5">
      {form.guardDialog}
      <TextField label="Name" required limit={LIMITS.name} autoComplete="off" {...form.field("name")} />
      <TextField label="Brokerage" limit={LIMITS.company} {...form.field("brokerage")} />
      {locked ? (
        <EmailLockedNote email={locked} />
      ) : (
        <TextField
          label="Email"
          type="email"
          limit={LIMITS.email}
          hint="The agent's own address — not the brokerage's shared inbox."
          {...form.field("email")}
        />
      )}
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
              {cityOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <TextField label="City" limit={LIMITS.city} {...form.field("city")} />
        )}
      </div>
      <TextField label="Website" placeholder="example.com" limit={LIMITS.website} {...form.field("website")} />
      <TextAreaField label="Notes" limit={Math.max(LIMITS.notes, initial.notes.length)} {...form.field("notes")} />
      <div aria-live="polite">{form.formError && <p className="notice-error">{form.formError}</p>}</div>
      <button type="submit" disabled={form.isPending} className="btn-primary">
        {form.isPending ? "Saving…" : mode.kind === "edit" ? "Save changes" : "Add agent"}
      </button>
    </form>
  );
}
