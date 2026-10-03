"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { runPipelineScrapeAction, searchLeadsAction, type LeadSearchState } from "@/lib/actions/vault-pipeline";
import { runAgentPipelineScrapeAction, searchAgentsAction, type AgentSearchState } from "@/lib/actions/dataleadsell";
import { runHaulerScrapeAction, searchHaulersAction } from "@/lib/actions/garbage-ai";
import type { ActionResult } from "@/lib/outreach/lead-actions";
import { LEAD_NOUN, PIPELINE_BASE_PATH, type PipelineId } from "@/lib/outreach/pipeline-id";
import { US_STATE_OPTIONS } from "@/lib/us-states";
import { SOLD_COUNTIES, citiesInCounty } from "@/lib/agent-cities";
import BulkSendButton from "@/components/BulkSendButton";
import { plural } from "@/lib/format";
import FindEmailsButton from "@/components/FindEmailsButton";
import ActionMessage, { type Feedback, unconfirmedMessage } from "@/components/ActionMessage";
import HowThisWorks from "@/components/HowThisWorks";

/**
 * Each control's result message belongs to the latest action only: starting
 * any control bumps the "epoch", and a message is shown only while its
 * control is the latest one started.
 */
type StartControl = () => number;

/**
 * The pipeline's manual controls: find new leads (next city, or a city you
 * pick), bulk-send the first pitch to New leads, and sweep unchecked leads
 * for an email.
 */
export default function OutreachControls({
  pipeline,
  paused,
  unsent,
  willSkip = 0,
  dailyRunUnsent = null,
  blocked,
  nextCity,
  sendHold = null,
}: {
  pipeline: PipelineId;
  paused: boolean;
  /** New leads with an address that a send would email right now. */
  unsent: number;
  /** New leads with an address that a send would skip (already pitched, a shared address, held by a reply…). */
  willSkip?: number;
  /** Of those, the ones the daily run will email (it only sends leads daily runs found); null when there is no daily run. */
  dailyRunUnsent?: number | null;
  /** Where "Find … in the next city" will search. */
  nextCity: string;
  /** New leads with an address that can't be sent (already pitched, opted out, unverified…). */
  blocked: number;
  /** Set while this pipeline's sends are held in code: why, shown instead of the send controls working. */
  sendHold?: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [showSearch, setShowSearch] = useState(false);
  const isAgents = pipeline === "dataleadsell";
  const isHaulers = pipeline === "garbage-ai";
  const noun = LEAD_NOUN[pipeline];

  const epochRef = useRef(0);
  const [epoch, setEpoch] = useState(0);
  const [feedbackEpoch, setFeedbackEpoch] = useState(-1);
  const startControl: StartControl = () => {
    epochRef.current += 1;
    setEpoch(epochRef.current);
    return epochRef.current;
  };

  function runPipeline() {
    setFeedbackEpoch(startControl());
    setFeedback(null);
    startTransition(async () => {
      let result: ActionResult;
      try {
        result = isAgents
          ? await runAgentPipelineScrapeAction()
          : isHaulers
            ? await runHaulerScrapeAction()
            : await runPipelineScrapeAction();
      } catch {
        result = { ok: false, error: unconfirmedMessage("the search ran") };
      }
      setFeedback(result.ok ? { ok: true, text: result.message } : { ok: false, text: result.error });
      router.refresh();
    });
  }

  return (
    <section aria-label="Pipeline controls" className="card flex flex-col gap-3 p-4">
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={isPending} onClick={runPipeline} className="btn-primary">
          {isPending ? "Searching… (up to a minute)" : `Find ${noun.many} in the next city`}
        </button>
        <p className="self-center text-sm muted">
          Next city: <strong className="font-medium text-zinc-800 dark:text-zinc-200">{nextCity}</strong>
        </p>
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
              <strong>{plural(unsent, noun.one, noun.many)}</strong> ready to email.{" "}
              {sendHold ? (
                <span className="muted">Nothing is emailed while sending is on hold.</span>
              ) : dailyRunUnsent === null ? (
                <span className="muted">They&apos;re only emailed when you press Send outreach to new {noun.many}.</span>
              ) : dailyRunUnsent >= unsent ? (
                <span className="muted">The next daily run will email them, or send them now.</span>
              ) : dailyRunUnsent > 0 ? (
                <span className="muted">
                  The next daily run will email the {dailyRunUnsent} it found; the other {unsent - dailyRunUnsent} (added by hand or by a
                  search) need Send outreach to new {noun.many}.
                </span>
              ) : (
                <span className="muted">
                  The daily run only emails {noun.many} it found itself, so these need Send outreach to new {noun.many}.
                </span>
              )}
            </>
          ) : (
            <span className="muted">No New {noun.many} are ready to email.</span>
          )}
          {willSkip > 0 && (
            <span className="muted">
              {" "}
              {plural(willSkip, `${unsent > 0 ? "other " : ""}New ${noun.one}`, `${unsent > 0 ? "other " : ""}New ${noun.many}`)} with an
              address will be skipped: the address was already pitched or is shared with another {noun.one}, is on the do-not-email list, or
              has a reply waiting.
            </span>
          )}
          {blocked > 0 && (
            <>
              {" "}
              <Link
                href={`${PIPELINE_BASE_PATH[pipeline]}?status=new`}
                className="text-indigo-700 underline underline-offset-2 dark:text-indigo-300"
              >
                {plural(blocked, `New ${noun.one}`, `New ${noun.many}`)} with an address {blocked === 1 ? "is" : "are"} held back
              </Link>{" "}
              <span className="muted">(already pitched, opted out, or the address needs checking — see the flagged rows).</span>
            </>
          )}
        </p>
        <BulkSendButton pipeline={pipeline} disabled={isPending || paused || sendHold !== null || unsent === 0} />
      </div>
      {sendHold && <p className="notice-warning">{sendHold}</p>}
      {paused && <p className="notice-warning">Outbound email is paused — sending is off until it&apos;s resumed in Settings.</p>}
      <ActionMessage feedback={feedbackEpoch === epoch ? feedback : null} />

      {showSearch &&
        (isAgents ? (
          <AgentSearchForm epoch={epoch} startControl={startControl} />
        ) : (
          <BusinessSearchForm epoch={epoch} startControl={startControl} haulers={isHaulers} />
        ))}

      <div className="border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <FindEmailsButton pipeline={pipeline} disabled={isPending} epoch={epoch} startControl={startControl} />
      </div>

      <HowThisWorks summary="How finding and sending work">
        <p>
          Only {isAgents ? "agents" : "businesses"} an email was found for are saved. Yelp{isAgents ? " and ADRE don't" : " doesn't"} give a
          website, so each search guesses one from the name and keeps it only if the site shows the {isAgents ? "agent" : "business"}&apos;s
          phone number, street address or city — expect fewer new {noun.many} than results.
          {isAgents ? " An agent is only saved with an address that is recognisably their own, never a brokerage's shared inbox." : ""}
        </p>
        {isHaulers && (
          <p>
            Each search asks Yelp for garbage collection in one city and leaves out current clients, national and large regional haulers,
            city and county departments, and anything in Mountain High Disposal&apos;s service area.
          </p>
        )}
        <p>Replies to your emails are logged automatically; record anything else from the lead page.</p>
      </HowThisWorks>
    </section>
  );
}

const initialSearch: LeadSearchState = {};

/** City search; Garbage AI's always searches for garbage collection, so it has no business-type field. */
function BusinessSearchForm({ epoch, startControl, haulers = false }: { epoch: number; startControl: StartControl; haulers?: boolean }) {
  const router = useRouter();
  const [values, setValues] = useState({ city: "", state: "", businessType: "" });
  const [submittedEpoch, setSubmittedEpoch] = useState(-1);
  const [clientError, setClientError] = useState<string | null>(null);
  const [state, action, pending] = useActionState(async (prev: LeadSearchState, formData: FormData) => {
    const result = haulers ? await searchHaulersAction(prev, formData) : await searchLeadsAction(prev, formData);
    router.refresh();
    return result;
  }, initialSearch);

  return (
    <form
      action={action}
      onSubmit={(e) => {
        setSubmittedEpoch(startControl());
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
          <select
            name="state"
            value={values.state}
            onChange={(e) => setValues({ ...values, state: e.target.value })}
            className="input"
            required
          >
            <option value="">Pick a state</option>
            {US_STATE_OPTIONS.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        {!haulers && (
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
        )}
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? "Searching…" : "Search"}
        </button>
      </div>
      {submittedEpoch === epoch && <SearchResult error={clientError ?? state.error} message={clientError ? undefined : state.message} />}
    </form>
  );
}

const initialAgentSearch: AgentSearchState = {};

function AgentSearchForm({ epoch, startControl }: { epoch: number; startControl: StartControl }) {
  const router = useRouter();
  const [submittedEpoch, setSubmittedEpoch] = useState(-1);
  const [county, setCounty] = useState(SOLD_COUNTIES[0]?.county ?? "");
  const [city, setCity] = useState("");
  const [state, action, pending] = useActionState(async (prev: AgentSearchState, formData: FormData) => {
    const result = await searchAgentsAction(prev, formData);
    router.refresh();
    return result;
  }, initialAgentSearch);
  const cities = citiesInCounty(county);

  return (
    <form
      action={action}
      onSubmit={() => setSubmittedEpoch(startControl())}
      className="flex flex-col gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800"
    >
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
      {submittedEpoch === epoch && <SearchResult error={state.error} message={state.message} />}
    </form>
  );
}

function SearchResult({ error, message }: { error?: string | null; message?: string }) {
  return <ActionMessage feedback={error ? { ok: false, text: error } : message ? { ok: true, text: message } : null} />;
}
