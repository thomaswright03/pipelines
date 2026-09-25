"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { runPipelineScrapeAction, searchLeadsAction, type LeadSearchState } from "@/lib/actions/vault-pipeline";
import { runAgentPipelineScrapeAction, searchAgentsAction, type AgentSearchState } from "@/lib/actions/dataleadsell";
import type { ActionResult } from "@/lib/outreach/lead-actions";
import type { PipelineId } from "@/lib/outreach/pipeline-id";
import { US_STATE_OPTIONS } from "@/lib/us-states";
import { SOLD_COUNTIES, citiesInCounty } from "@/lib/agent-cities";
import BulkSendButton from "@/components/BulkSendButton";
import { plural } from "@/lib/format";
import FindEmailsButton from "@/components/FindEmailsButton";
import ActionMessage, { type Feedback } from "@/components/ActionMessage";

/**
 * The pipeline's manual controls: find new leads (next city, or a city you
 * pick), bulk-send the first pitch to New leads, and sweep unchecked leads
 * for an email.
 */
export default function OutreachControls({
  pipeline,
  paused,
  unsent,
}: {
  pipeline: PipelineId;
  paused: boolean;
  /** New leads with an address that haven't been emailed yet. */
  unsent: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [showSearch, setShowSearch] = useState(false);
  const isAgents = pipeline === "dataleadsell";

  function runPipeline() {
    setFeedback(null);
    startTransition(async () => {
      let result: ActionResult;
      try {
        result = isAgents ? await runAgentPipelineScrapeAction() : await runPipelineScrapeAction();
      } catch {
        result = { ok: false, error: "Couldn't reach the server — nothing was run. Check your connection and try again." };
      }
      setFeedback(result.ok ? { ok: true, text: result.message } : { ok: false, text: result.error });
      router.refresh();
    });
  }

  return (
    <section aria-label="Pipeline controls" className="card flex flex-col gap-3 p-4">
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={isPending} onClick={runPipeline} className="btn-primary">
          {isPending ? "Searching… (up to a minute)" : isAgents ? "Find agents in the next city" : "Find leads in the next city"}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => setShowSearch((v) => !v)}
          aria-expanded={showSearch}
          className="btn-secondary"
        >
          Search a specific city
        </button>
      </div>
      <div
        className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg px-3 py-2 ${
          unsent > 0 ? "bg-indigo-50 dark:bg-indigo-950/40" : "bg-zinc-50 dark:bg-zinc-900"
        }`}
      >
        <p className="flex-1 text-sm">
          {unsent > 0 ? (
            <>
              <strong>{plural(unsent, isAgents ? "agent" : "lead", isAgents ? "agents" : "leads")}</strong> found but not yet
              emailed.
            </>
          ) : (
            <span className="muted">Every lead with an email address has been emailed.</span>
          )}
        </p>
        <BulkSendButton pipeline={pipeline} disabled={isPending || paused || unsent === 0} />
      </div>
      {paused && <p className="notice-warning">Outbound email is paused — sending is off until it&apos;s resumed in Settings.</p>}
      <ActionMessage feedback={feedback} />

      {showSearch && (isAgents ? <AgentSearchForm /> : <BusinessSearchForm />)}

      <div className="border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <FindEmailsButton pipeline={pipeline} disabled={isPending} />
      </div>

      <p className="text-xs muted">
        Only {isAgents ? "agents" : "businesses"} an email was found for are saved. Yelp{isAgents ? " and ADRE don't" : " doesn't"} give
        a website, so each search guesses one from the name (a few plausible domains, checked directly) — expect fewer new leads
        than results.{" "}
        {isAgents
          ? "An agent is only saved with an address that is recognisably their own, never a brokerage's shared inbox."
          : ""}{" "}
        Replies to your emails are logged automatically; record anything else from the lead page.
      </p>
    </section>
  );
}

const initialSearch: LeadSearchState = {};

function BusinessSearchForm() {
  const router = useRouter();
  const [values, setValues] = useState({ city: "", state: "", businessType: "" });
  const [clientError, setClientError] = useState<string | null>(null);
  const [state, action, pending] = useActionState(async (prev: LeadSearchState, formData: FormData) => {
    const result = await searchLeadsAction(prev, formData);
    router.refresh();
    return result;
  }, initialSearch);

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!values.city.trim() || !values.state) {
          e.preventDefault();
          setClientError(!values.city.trim() ? "Enter a city." : "Pick a state.");
          return;
        }
        setClientError(null);
      }}
      className="flex flex-col gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800"
      noValidate
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className="field-label w-40">
          City
          <input
            name="city"
            value={values.city}
            maxLength={80}
            onChange={(e) => setValues({ ...values, city: e.target.value })}
            placeholder="Provo"
            className="input"
            required
          />
        </label>
        <label className="field-label w-44">
          State
          <select name="state" value={values.state} onChange={(e) => setValues({ ...values, state: e.target.value })} className="input" required>
            <option value="">Pick a state</option>
            {US_STATE_OPTIONS.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field-label w-44">
          Business type (optional)
          <input
            name="businessType"
            value={values.businessType}
            maxLength={80}
            onChange={(e) => setValues({ ...values, businessType: e.target.value })}
            placeholder="dentist"
            className="input"
          />
        </label>
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? "Searching…" : "Search"}
        </button>
      </div>
      <SearchResult error={clientError ?? state.error} message={clientError ? undefined : state.message} />
    </form>
  );
}

const initialAgentSearch: AgentSearchState = {};

function AgentSearchForm() {
  const router = useRouter();
  const [county, setCounty] = useState(SOLD_COUNTIES[0]?.county ?? "");
  const [city, setCity] = useState("");
  const [state, action, pending] = useActionState(async (prev: AgentSearchState, formData: FormData) => {
    const result = await searchAgentsAction(prev, formData);
    router.refresh();
    return result;
  }, initialAgentSearch);
  const cities = citiesInCounty(county);

  return (
    <form action={action} className="flex flex-col gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
      <div className="flex flex-wrap items-end gap-2">
        <label className="field-label w-44">
          County
          <select
            name="county"
            value={county}
            onChange={(e) => {
              setCounty(e.target.value);
              setCity("");
            }}
            className="input"
          >
            {SOLD_COUNTIES.map((c) => (
              <option key={c.county} value={c.county}>
                {c.county} County, {c.state}
              </option>
            ))}
          </select>
        </label>
        <label className="field-label w-48">
          City
          <select name="city" value={city} onChange={(e) => setCity(e.target.value)} className="input" required>
            <option value="">Pick a city</option>
            {cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={pending || !city} className="btn-primary">
          {pending ? "Searching…" : "Search"}
        </button>
      </div>
      <SearchResult error={state.error} message={state.message} />
    </form>
  );
}

function SearchResult({ error, message }: { error?: string | null; message?: string }) {
  return <ActionMessage feedback={error ? { ok: false, text: error } : message ? { ok: true, text: message } : null} />;
}
