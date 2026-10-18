// The automated run every pipeline shares (Cold Outreach, dataleadsell and
// Garbage AI), several times a day: work out how many of the day's emails
// are still to send (the "emails to send per day" setting minus what this
// pipeline already sent today), and if the leads waiting from earlier runs
// don't cover it, search one new city on Yelp and check its results for
// email addresses until enough are found. Then pitch the waiting leads, up
// to the day's remaining number. Once the day's number is sent, later runs
// that day do nothing. A failed search is
// recorded and doesn't stop the leftover leads from being emailed. While
// outbound email is paused (Settings or OUTBOUND_EMAIL_DISABLED) the run
// does nothing at all: no search, no lookups, no sends. Discovery and
// sending go through the same shared rules as the buttons on the pages
// (this folder), so a cron run and a manual bulk send can overlap without
// double-sending.
//
// Each pipeline supplies only what differs (its spec, in
// src/lib/vault-daily-run.ts, src/lib/dataleadsell-daily-run.ts and
// src/lib/garbage-ai-daily-run.ts): the Yelp term, its city picker, its
// lead table, its wording, and — for Garbage AI — the results it must
// never pitch.
import type { Prisma } from "@/generated/prisma/client";
import { findBusinessesViaYelp, YelpError, type YelpCandidate } from "@/lib/yelp-discovery";
import { withRetry } from "@/lib/with-retry";
import { createLeadsFromCandidates, type DiscoveryCandidate, type DiscoveryResult } from "@/lib/outreach/discovery";
import { describeError, logError } from "@/lib/log";
import { sendFirstTouch } from "@/lib/outreach/send";
import { getAppSettings } from "@/lib/outreach/settings";
import { OUTBOUND_DISABLED_ENV } from "@/lib/outbound-switch";
import { getPipeline } from "@/lib/outreach/pipelines";
import { prisma } from "@/lib/db";
import { startOfZoneDay } from "@/lib/time";
import type { PipelineId } from "@/lib/outreach/pipeline-id";
import type { RunOutcome } from "@/lib/outreach/runs";

/** The `source` of every lead a Cold Outreach or dataleadsell daily run saves (Garbage AI has its own). */
export const DAILY_RUN_SOURCE = "Yelp search (daily automated run)";

// Vercel Hobby functions stop at 60 s, and the run must record its outcome
// before then. Every step starts only if its worst case fits:
// - discovery (including the Yelp call, ≤10 s) ends by 25 s — no lookup
//   starts with under 2 s left, and one in progress is cut off at 25 s;
// - a send starts only if its worst case (SMTP connect 5 s + greeting 5 s +
//   socket 10 s) still ends by 55 s;
// which leaves ~5 s to record the run. Leads found but not sent in time are
// picked up by the next daily run.
const DISCOVERY_BUDGET_MS = 25_000;
const RUN_LIMIT_MS = 55_000;
const SEND_WORST_CASE_MS = 20_000;
const SEND_DELAY_MS = 500;

export type DailyRunOptions = {
  sendDelayMs?: number;
  /** Overrides the 55 s limit that sends must finish within (tests). */
  sendBudgetMs?: number;
  discoveryBudgetMs?: number;
  /** The clock (tests pass a fake one). */
  now?: () => number;
};

/** New leads with an address that a Cold Outreach or dataleadsell daily run found and hasn't emailed yet. */
export const UNSENT_DAILY = {
  source: DAILY_RUN_SOURCE,
  status: "new",
  email: { not: null },
  sendBlockedReason: null,
} as const satisfies Prisma.LeadWhereInput & Prisma.AgentLeadWhereInput;

type DailyRunTarget = { city: string; state: string; county?: string };

type DailyRunSpec<T extends DailyRunTarget> = {
  pipeline: PipelineId;
  /** The Yelp search term ("" searches every kind of business). */
  searchTerm: string;
  /** What Yelp lists, for the summary ("Yelp listed 50 businesses"). */
  listedNoun: { one: string; many: string };
  /** What the run finds, for the summary ("so no new leads were found"). */
  foundNoun: string;
  /** The next city to search. It is only marked as used once its search came back. */
  pickTarget(): Promise<T>;
  markTargetUsed(target: T): Promise<void>;
  /** The city as the summary names it. */
  describeTarget(target: T): string;
  /** New, sendable leads found by daily runs, oldest first, at most `take`. */
  listUnsent(take: number): Promise<{ id: string; name: string }[]>;
  /** The `source` saved on the leads this run finds (default DAILY_RUN_SOURCE). */
  source?: string;
  /**
   * Leaves out the results this pipeline must never pitch, before any
   * lookup, and says how many in the summary's words ("left out 4 that…").
   * Without it every result is a candidate.
   */
  screen?(results: YelpCandidate[]): { kept: DiscoveryCandidate[]; leftOut: string | null };
};

// Refusals are the rules working (address already pitched, opted out, the
// lead changed meanwhile) — reported as skipped, never as a failure.
const SEND_FAILURES = new Set(["send_failed", "delivery_unknown"]);

export async function runDailyDiscoveryAndSend<T extends DailyRunTarget>(
  spec: DailyRunSpec<T>,
  emailsPerDay: number,
  options: DailyRunOptions = {},
): Promise<RunOutcome> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const settings = await getAppSettings();
  if (settings.outboundPaused) {
    if (settings.pausedBy === "environment") {
      return {
        status: "skipped",
        summary: `Sending is switched off by whoever manages the app's hosting, so the daily run didn't search or send. (For your developer: ${OUTBOUND_DISABLED_ENV} is set.)`,
      };
    }
    return { status: "skipped", summary: "Outbound email is paused, so the daily run didn't search or send." };
  }

  // What today still needs: the day's number minus what this pipeline has
  // already sent since midnight Arizona time (by hand or by a run).
  const pipeline = getPipeline(spec.pipeline);
  const sentToday = await withRetry(() => pipeline.countSendsSince(prisma, startOfZoneDay(0, new Date(startedAt))));
  const remaining = Math.max(0, emailsPerDay - sentToday);
  if (remaining === 0) {
    return {
      status: "skipped",
      summary: `Already sent ${sentToday} ${sentToday === 1 ? "email" : "emails"} today, which meets the daily number (${emailsPerDay}), so this run didn't search or send.`,
    };
  }
  // A pipeline whose sends are held in code (pipelines.ts) still finds
  // leads (until a day's worth is waiting), but its run emails nobody.
  const hold = pipeline.sendHold;
  const waiting = (await spec.listUnsent(remaining)).length;
  const needed = remaining - waiting;

  // Discovery failing (Yelp down, rate-limited, key revoked) must not stop
  // the leads earlier runs already found from being emailed: the error is
  // recorded and the run goes on to the send queue. The city is only marked
  // as used when its search actually came back. When enough leads are
  // already waiting, no city is searched.
  let where: string | null = null;
  let listed: number | null = null;
  let leftOut: string | null = null;
  let discovery: DiscoveryResult | null = null;
  let discoveryError: string | null = null;
  if (needed > 0) {
    const target = await withRetry(() => spec.pickTarget());
    where = spec.describeTarget(target);
    try {
      const results = await findBusinessesViaYelp(spec.searchTerm, `${target.city}, ${target.state}`);
      listed = results.length;
      await withRetry(() => spec.markTargetUsed(target));
      const screened = spec.screen ? spec.screen(results) : { kept: results, leftOut: null };
      leftOut = screened.leftOut;
      discovery = await createLeadsFromCandidates(spec.pipeline, screened.kept, {
        city: target.city,
        county: target.county ?? null,
        state: target.state,
        source: spec.source ?? DAILY_RUN_SOURCE,
        maxCreate: needed,
        deadline: startedAt + (options.discoveryBudgetMs ?? DISCOVERY_BUDGET_MS),
        now,
      });
    } catch (err) {
      logError("run.daily.discovery", err, { pipeline: spec.pipeline, city: target.city, county: target.county, state: target.state });
      discoveryError = err instanceof YelpError ? err.unattended : describeError(err);
    }
  }

  const created = discovery?.created ?? [];
  const examined = discovery?.examined ?? 0;
  const createdIds = new Set(created.map((l) => l.id));
  const queue = hold ? [] : await spec.listUnsent(remaining);
  const carriedOver = queue.filter((l) => !createdIds.has(l.id)).length;
  const sendsEndBy = startedAt + (options.sendBudgetMs ?? RUN_LIMIT_MS);

  let sent = 0;
  let failed = 0;
  let refused = 0;
  let skipped = 0;
  let deferred = 0;
  const errors: string[] = discoveryError ? [`Search of ${where} failed: ${discoveryError}`] : [];
  for (const [index, lead] of queue.entries()) {
    if (now() + SEND_WORST_CASE_MS > sendsEndBy) {
      deferred = queue.length - index;
      break;
    }
    const outcome = await sendFirstTouch(spec.pipeline, lead.id);
    if (outcome.ok) {
      sent++;
      if (outcome.warning) errors.push(`${lead.name}: ${outcome.warning}`);
    } else if (outcome.reason === "paused") {
      errors.push(`${lead.name}: ${outcome.message}`);
      deferred = queue.length - index;
      break;
    } else if (outcome.reason === "address_refused") {
      // One bad address, not a failure of the run: the lead is flagged (or,
      // after a temporary refusal, tried again by a later run).
      refused++;
      errors.push(`${lead.name}: ${outcome.message}`);
    } else if (SEND_FAILURES.has(outcome.reason)) {
      failed++;
      errors.push(`${lead.name}: ${outcome.message}`);
    } else {
      skipped++;
      errors.push(`Skipped ${lead.name}: ${outcome.message}`);
    }
    const delay = options.sendDelayMs ?? SEND_DELAY_MS;
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  }

  const parts =
    where === null
      ? ["Enough leads were already waiting, so no city was searched"]
      : discovery && listed !== null
        ? [
            `Searched ${where}: Yelp listed ${listed} ${listed === 1 ? spec.listedNoun.one : spec.listedNoun.many}`,
            ...(leftOut ? [leftOut] : []),
            `checked ${examined} for an email${discovery.stoppedEarly ? " (stopped early: out of time)" : ""}`,
            `found ${created.length} new ${created.length === 1 ? "address" : "addresses"}`,
          ]
        : [`Couldn't search ${where}${listed === null ? " on Yelp" : " for email addresses"}, so no new ${spec.foundNoun} were found`];
  if (carriedOver) parts.push(`${carriedOver} left over from earlier runs`);
  parts.push(hold ? "sending is on hold, so nobody was emailed" : `emailed ${sent}`);
  if (skipped) parts.push(`${skipped} skipped by the send rules`);
  if (refused) parts.push(`${refused} ${refused === 1 ? "address" : "addresses"} refused by the recipient's mail server`);
  if (failed) parts.push(`${failed} failed to send`);
  if (deferred) parts.push(`${deferred} left for the next run (out of time)`);
  if (!hold) parts.push(`${sentToday + sent} of today's ${emailsPerDay} sent`);
  const summary = `${parts.join(", ")}.`;

  // Send refusals are the rules working, and a refused address is that
  // lead's problem (flagged on it); only a failed search or a failed
  // send makes a run partial, and it is "failed" only when nothing got done.
  const problems = failed > 0 || discoveryError !== null;
  const status = !problems ? "succeeded" : sent > 0 ? "partial" : "failed";
  return {
    status,
    summary,
    errors,
    numbers: { businessesChecked: examined, leadsFound: created.length, emailsSent: sent },
  };
}
