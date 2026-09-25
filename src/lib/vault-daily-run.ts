// The daily automated Cold Outreach run: search one new city on Yelp,
// check up to the configured number of those businesses for an email
// address, save the ones an address was found for, then pitch every
// sendable lead the daily runs have found — this run's plus any an earlier
// run found but didn't get to (out of time, or the email service was down).
// A failed search is recorded and doesn't stop the leftover leads from
// being emailed. Discovery and sending go through the same shared rules as the buttons on
// the page (src/lib/outreach/), so a cron run and a manual bulk send can
// overlap without double-sending.
import { prisma } from "@/lib/db";
import { findBusinessesViaYelp, YelpError } from "@/lib/yelp-discovery";
import { pickNextCity, markCityUsed } from "@/lib/vault-city-picker";
import { withRetry } from "@/lib/with-retry";
import { createLeadsFromCandidates, type DiscoveryResult } from "@/lib/outreach/discovery";
import { describeError, logError } from "@/lib/log";
import { sendFirstTouch } from "@/lib/outreach/send";
import { getAppSettings } from "@/lib/outreach/settings";
import type { RunOutcome } from "@/lib/outreach/runs";

export const DAILY_RUN_SOURCE = "Yelp search (daily automated run)";
const DEFAULT_BUSINESSES_PER_RUN = 30;

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
/** Most leftover leads one run will queue; the time budget usually stops it well before. */
const MAX_SEND_QUEUE = 100;

export type DailyRunOptions = {
  sendDelayMs?: number;
  /** Overrides the 55 s limit that sends must finish within (tests). */
  sendBudgetMs?: number;
  discoveryBudgetMs?: number;
  /** The clock (tests pass a fake one). */
  now?: () => number;
};

// Refusals are the rules working (address already pitched, opted out, the
// lead changed meanwhile) — reported as skipped, never as a failure.
const SEND_FAILURES = new Set(["send_failed", "delivery_unknown"]);

/** New, sendable leads found by daily runs, oldest first. */
function listUnsentDailyLeads() {
  return prisma.lead.findMany({
    where: { source: DAILY_RUN_SOURCE, status: "new", email: { not: null }, sendBlockedReason: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
    take: MAX_SEND_QUEUE,
  });
}

export async function runDailyColdOutreach(
  businessesPerRun: number = DEFAULT_BUSINESSES_PER_RUN,
  options: DailyRunOptions = {},
): Promise<RunOutcome> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  if ((await getAppSettings()).outboundPaused) {
    return { status: "skipped", summary: "Outbound email is paused, so the daily run didn't search or send." };
  }

  // Discovery failing (Yelp down, rate-limited, key revoked) must not stop
  // the leads earlier runs already found from being emailed: the error is
  // recorded and the run goes on to the send queue. The city is only marked
  // as used when its search actually came back.
  const target = await withRetry(() => pickNextCity(prisma));
  let listed: number | null = null;
  let discovery: DiscoveryResult | null = null;
  let discoveryError: string | null = null;
  try {
    const results = await findBusinessesViaYelp("", `${target.city}, ${target.state}`);
    listed = results.length;
    await withRetry(() => markCityUsed(prisma, target.city, target.state));
    discovery = await createLeadsFromCandidates("cold-outreach", results.slice(0, businessesPerRun), {
      city: target.city,
      state: target.state,
      source: DAILY_RUN_SOURCE,
      maxCreate: businessesPerRun,
      deadline: startedAt + (options.discoveryBudgetMs ?? DISCOVERY_BUDGET_MS),
      now,
    });
  } catch (err) {
    logError("run.daily.discovery", err, { city: target.city, state: target.state });
    discoveryError = err instanceof YelpError ? err.message : describeError(err);
  }

  const created = discovery?.created ?? [];
  const examined = discovery?.examined ?? 0;
  const createdIds = new Set(created.map((l) => l.id));
  const queue = await listUnsentDailyLeads();
  const carriedOver = queue.filter((l) => !createdIds.has(l.id)).length;
  const sendsEndBy = startedAt + (options.sendBudgetMs ?? RUN_LIMIT_MS);

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let deferred = 0;
  const errors: string[] = discoveryError ? [`Search of ${target.city}, ${target.state} failed: ${discoveryError}`] : [];
  for (const [index, lead] of queue.entries()) {
    if (now() + SEND_WORST_CASE_MS > sendsEndBy) {
      deferred = queue.length - index;
      break;
    }
    const outcome = await sendFirstTouch("cold-outreach", lead.id);
    if (outcome.ok) {
      sent++;
      if (outcome.warning) errors.push(`${lead.name}: ${outcome.warning}`);
    } else if (outcome.reason === "paused") {
      errors.push(`${lead.name}: ${outcome.message}`);
      deferred = queue.length - index;
      break;
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
    discovery && listed !== null
      ? [
          `Searched ${target.city}, ${target.state}: Yelp listed ${listed} businesses`,
          `checked ${examined} for an email${discovery.stoppedEarly ? " (stopped early: out of time)" : ""}`,
          `found ${created.length} new ${created.length === 1 ? "address" : "addresses"}`,
        ]
      : [`Couldn't search ${target.city}, ${target.state}${listed === null ? " on Yelp" : " for email addresses"}, so no new leads were found`];
  if (carriedOver) parts.push(`${carriedOver} left over from earlier runs`);
  parts.push(`emailed ${sent}`);
  if (skipped) parts.push(`${skipped} skipped by the send rules`);
  if (failed) parts.push(`${failed} failed to send`);
  if (deferred) parts.push(`${deferred} left for the next run (out of time)`);
  const summary = `${parts.join(", ")}.`;

  // Send refusals are the rules working; only a failed search or a failed
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
