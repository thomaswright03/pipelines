// The daily automated Cold Outreach run: search one new city on Yelp,
// save the businesses an address was found for (capped at the configured
// count), then pitch exactly those leads. Discovery and sending go through
// the same shared rules as the buttons on the page (src/lib/outreach/), so
// a cron run and a manual bulk send can overlap without double-sending.
import { prisma } from "@/lib/db";
import { findBusinessesViaYelp } from "@/lib/yelp-discovery";
import { pickNextCity, markCityUsed } from "@/lib/vault-city-picker";
import { withRetry } from "@/lib/with-retry";
import { createLeadsFromCandidates } from "@/lib/outreach/discovery";
import { sendFirstTouch } from "@/lib/outreach/send";
import { getAppSettings } from "@/lib/outreach/settings";
import type { RunOutcome } from "@/lib/outreach/runs";

export const DAILY_RUN_SOURCE = "Yelp search (daily automated run)";
const DEFAULT_LEAD_COUNT = 30;

// Vercel Hobby functions stop at 60 s. Discovery gets the first 30 s; no new
// send starts after 45 s, and a send fails within ~15 s at worst, so the run
// always finishes (and records its outcome) inside the limit. Leads found
// but not sent in time stay "new" for the next bulk send.
const DISCOVERY_BUDGET_MS = 30_000;
const SEND_BUDGET_MS = 45_000;
const SEND_DELAY_MS = 500;

export async function runDailyColdOutreach(
  leadCount: number = DEFAULT_LEAD_COUNT,
  options: { sendDelayMs?: number } = {},
): Promise<RunOutcome> {
  const startedAt = Date.now();
  if ((await getAppSettings()).outboundPaused) {
    return { status: "skipped", summary: "Outbound email is paused, so the daily run didn't search or send." };
  }

  const target = await withRetry(() => pickNextCity(prisma));
  const results = await findBusinessesViaYelp("", `${target.city}, ${target.state}`);
  await withRetry(() => markCityUsed(prisma, target.city, target.state));

  const discovery = await createLeadsFromCandidates("cold-outreach", results.slice(0, leadCount), {
    city: target.city,
    state: target.state,
    source: DAILY_RUN_SOURCE,
    maxCreate: leadCount,
    deadline: startedAt + DISCOVERY_BUDGET_MS,
  });

  let sent = 0;
  let notSent = 0;
  let deferred = 0;
  const errors: string[] = [];
  for (const lead of discovery.created) {
    if (Date.now() > startedAt + SEND_BUDGET_MS) {
      deferred = discovery.created.length - sent - notSent;
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
        deferred = discovery.created.length - sent - notSent;
        break;
      }
    }
    const delay = options.sendDelayMs ?? SEND_DELAY_MS;
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  }

  const parts = [
    `Searched ${target.city}, ${target.state}: ${results.length} businesses`,
    `${discovery.created.length} new leads with an email`,
    `${sent} emailed`,
  ];
  if (notSent) parts.push(`${notSent} not sent`);
  if (deferred) parts.push(`${deferred} left for the next send (out of time)`);
  const summary = `${parts.join(", ")}.`;

  const status = notSent === 0 ? "succeeded" : sent === 0 ? "failed" : "partial";
  return { status, summary, errors };
}
