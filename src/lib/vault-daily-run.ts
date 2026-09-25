// The daily automated Cold Outreach run: search one new city on Yelp,
// check up to the configured number of those businesses for an email
// address, save the ones an address was found for, then pitch every
// sendable lead the daily runs have found — this run's plus any an earlier
// run found but didn't get to (out of time, or the email service was down).
// Discovery and sending go through the same shared rules as the buttons on
// the page (src/lib/outreach/), so a cron run and a manual bulk send can
// overlap without double-sending.
import { prisma } from "@/lib/db";
import { findBusinessesViaYelp } from "@/lib/yelp-discovery";
import { pickNextCity, markCityUsed } from "@/lib/vault-city-picker";
import { withRetry } from "@/lib/with-retry";
import { createLeadsFromCandidates } from "@/lib/outreach/discovery";
import { sendFirstTouch } from "@/lib/outreach/send";
import { getAppSettings } from "@/lib/outreach/settings";
import type { RunOutcome } from "@/lib/outreach/runs";

export const DAILY_RUN_SOURCE = "Yelp search (daily automated run)";
const DEFAULT_BUSINESSES_PER_RUN = 30;

// Vercel Hobby functions stop at 60 s. Discovery gets the first 30 s; no new
// send starts after 45 s, and a send fails within ~15 s at worst, so the run
// always finishes (and records its outcome) inside the limit. Leads found
// but not sent in time are picked up by the next daily run.
const DISCOVERY_BUDGET_MS = 30_000;
const SEND_BUDGET_MS = 45_000;
const SEND_DELAY_MS = 500;
/** Most leftover leads one run will queue; the time budget usually stops it well before. */
const MAX_SEND_QUEUE = 100;

export type DailyRunOptions = { sendDelayMs?: number; sendBudgetMs?: number; discoveryBudgetMs?: number };

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
  const startedAt = Date.now();
  if ((await getAppSettings()).outboundPaused) {
    return { status: "skipped", summary: "Outbound email is paused, so the daily run didn't search or send." };
  }

  const target = await withRetry(() => pickNextCity(prisma));
  const results = await findBusinessesViaYelp("", `${target.city}, ${target.state}`);
  await withRetry(() => markCityUsed(prisma, target.city, target.state));

  const discovery = await createLeadsFromCandidates("cold-outreach", results.slice(0, businessesPerRun), {
    city: target.city,
    state: target.state,
    source: DAILY_RUN_SOURCE,
    maxCreate: businessesPerRun,
    deadline: startedAt + (options.discoveryBudgetMs ?? DISCOVERY_BUDGET_MS),
  });

  const createdIds = new Set(discovery.created.map((l) => l.id));
  const queue = await listUnsentDailyLeads();
  const carriedOver = queue.filter((l) => !createdIds.has(l.id)).length;
  const sendDeadline = startedAt + (options.sendBudgetMs ?? SEND_BUDGET_MS);

  let sent = 0;
  let notSent = 0;
  let deferred = 0;
  const errors: string[] = [];
  for (const [index, lead] of queue.entries()) {
    if (Date.now() > sendDeadline) {
      deferred = queue.length - index;
      break;
    }
    const outcome = await sendFirstTouch("cold-outreach", lead.id);
    if (outcome.ok) {
      sent++;
      if (outcome.warning) errors.push(`${lead.name}: ${outcome.warning}`);
    } else {
      notSent++;
      errors.push(`${lead.name}: ${outcome.message}`);
      if (outcome.reason === "paused") {
        deferred = queue.length - index - 1;
        break;
      }
    }
    const delay = options.sendDelayMs ?? SEND_DELAY_MS;
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  }

  const parts = [
    `Searched ${target.city}, ${target.state}: Yelp listed ${results.length} businesses`,
    `checked ${discovery.examined} for an email${discovery.stoppedEarly ? " (stopped early: out of time)" : ""}`,
    `found ${discovery.created.length} new ${discovery.created.length === 1 ? "address" : "addresses"}`,
  ];
  if (carriedOver) parts.push(`${carriedOver} left over from earlier runs`);
  parts.push(`emailed ${sent}`);
  if (notSent) parts.push(`${notSent} not sent`);
  if (deferred) parts.push(`${deferred} left for the next run (out of time)`);
  const summary = `${parts.join(", ")}.`;

  const status = notSent === 0 ? "succeeded" : sent === 0 ? "failed" : "partial";
  return {
    status,
    summary,
    errors,
    numbers: { businessesChecked: discovery.examined, leadsFound: discovery.created.length, emailsSent: sent },
  };
}
