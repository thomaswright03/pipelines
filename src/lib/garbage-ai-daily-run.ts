// The daily Garbage AI run and its "Find haulers" buttons: search one city
// on Yelp for waste haulers, drop the ones Garbage AI must never pitch (see
// garbage-ai-targeting.ts), check the rest for an email address on their own
// website, and save the ones an address was found for. While sending is
// held (garbage-ai-config.ts) the run never emails anyone; once it isn't,
// it pitches the haulers daily runs found, like the Cold Outreach run.
import { prisma } from "@/lib/db";
import { findBusinessesViaYelp, YelpError } from "@/lib/yelp-discovery";
import { markHaulerCityUsed, pickNextHaulerCity } from "@/lib/garbage-ai-city-picker";
import { haulerExclusion } from "@/lib/garbage-ai-targeting";
import { GARBAGE_AI_YELP_TERM } from "@/lib/garbage-ai-config";
import { withRetry } from "@/lib/with-retry";
import { createLeadsFromCandidates, describeDiscovery, type DiscoveryResult } from "@/lib/outreach/discovery";
import { describeError, logError } from "@/lib/log";
import { sendFirstTouch } from "@/lib/outreach/send";
import { getPipeline } from "@/lib/outreach/pipelines";
import type { RunOutcome } from "@/lib/outreach/runs";

export const GARBAGE_AI_DAILY_SOURCE = "Yelp search (daily Garbage AI run)";
const DEFAULT_BUSINESSES_PER_RUN = 30;

// Same time budget as the Cold Outreach run (see vault-daily-run.ts):
// discovery ends by 25 s, a send starts only if it can end by 55 s.
const DISCOVERY_BUDGET_MS = 25_000;
const RUN_LIMIT_MS = 55_000;
const SEND_WORST_CASE_MS = 20_000;
const SEND_DELAY_MS = 500;
const MAX_SEND_QUEUE = 100;

type SearchOutcome = {
  listed: number;
  excluded: number;
  discovery: DiscoveryResult;
};

/**
 * Searches one city for haulers and saves the ones an address was found
 * for, leaving out every hauler Garbage AI must never pitch. Yelp and the
 * lookups are the only outside calls; nothing is emailed here.
 */
export async function searchHaulers(
  city: string,
  state: string,
  ctx: { source: string; maxCreate: number; deadline: number; now?: () => number },
): Promise<SearchOutcome> {
  const results = await findBusinessesViaYelp(GARBAGE_AI_YELP_TERM, `${city}, ${state}`);
  const allowed = results.filter((r) => haulerExclusion(r) === null);
  const discovery = await createLeadsFromCandidates(
    "garbage-ai",
    allowed.slice(0, ctx.maxCreate).map((r) => ({ ...r, services: r.categories.join(", ") || null })),
    { city, state, source: ctx.source, maxCreate: ctx.maxCreate, deadline: ctx.deadline, now: ctx.now },
  );
  return { listed: results.length, excluded: results.length - allowed.length, discovery };
}

/** One line for the operator about what a hauler search did. */
export function describeHaulerSearch(where: string, outcome: SearchOutcome): string {
  const line = describeDiscovery("garbage-ai", where, outcome.listed, outcome.discovery);
  return outcome.excluded
    ? `${line} Left out ${outcome.excluded} that Garbage AI never pitches (current clients, national haulers, city departments, or in Mountain High's area).`
    : line;
}

type DailyRunOptions = {
  sendDelayMs?: number;
  sendBudgetMs?: number;
  discoveryBudgetMs?: number;
  now?: () => number;
};

const SEND_FAILURES = new Set(["send_failed", "delivery_unknown"]);
const UNSENT_DAILY = { source: GARBAGE_AI_DAILY_SOURCE, status: "new", email: { not: null }, sendBlockedReason: null };

/** How many haulers daily runs found that haven't been emailed. */
export function countUnsentDailyHaulers(): Promise<number> {
  return prisma.haulerLead.count({ where: UNSENT_DAILY });
}

export async function runDailyGarbageAi(
  businessesPerRun: number = DEFAULT_BUSINESSES_PER_RUN,
  options: DailyRunOptions = {},
): Promise<RunOutcome> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const hold = getPipeline("garbage-ai").sendHold;

  const target = await withRetry(() => pickNextHaulerCity(prisma));
  let outcome: SearchOutcome | null = null;
  let searchError: string | null = null;
  try {
    outcome = await searchHaulers(target.city, target.state, {
      source: GARBAGE_AI_DAILY_SOURCE,
      maxCreate: businessesPerRun,
      deadline: startedAt + (options.discoveryBudgetMs ?? DISCOVERY_BUDGET_MS),
      now,
    });
    await withRetry(() => markHaulerCityUsed(prisma, target.city, target.state));
  } catch (err) {
    logError("run.garbage-ai.discovery", err, { city: target.city, state: target.state });
    searchError = err instanceof YelpError ? err.unattended : describeError(err);
  }

  const errors: string[] = searchError ? [`Search of ${target.city}, ${target.state} failed: ${searchError}`] : [];
  const created = outcome?.discovery.created ?? [];
  const examined = outcome?.discovery.examined ?? 0;
  const parts = outcome
    ? [describeHaulerSearch(`${target.city}, ${target.state}`, outcome).replace(/\.$/, "")]
    : [`Couldn't search ${target.city}, ${target.state}, so no new haulers were found`];

  let sent = 0;
  let failed = 0;
  if (hold) {
    parts.push("sending is on hold, so nobody was emailed");
  } else {
    const queue = await prisma.haulerLead.findMany({
      where: UNSENT_DAILY,
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
      take: MAX_SEND_QUEUE,
    });
    const sendsEndBy = startedAt + (options.sendBudgetMs ?? RUN_LIMIT_MS);
    let deferred = 0;
    for (const [index, lead] of queue.entries()) {
      if (now() + SEND_WORST_CASE_MS > sendsEndBy) {
        deferred = queue.length - index;
        break;
      }
      const result = await sendFirstTouch("garbage-ai", lead.id);
      if (result.ok) sent++;
      else if (result.reason === "paused") {
        errors.push(`${lead.name}: ${result.message}`);
        deferred = queue.length - index;
        break;
      } else {
        if (SEND_FAILURES.has(result.reason)) failed++;
        errors.push(`${lead.name}: ${result.message}`);
      }
      const delay = options.sendDelayMs ?? SEND_DELAY_MS;
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    }
    parts.push(`emailed ${sent}`);
    if (failed) parts.push(`${failed} failed to send`);
    if (deferred) parts.push(`${deferred} left for the next run`);
  }

  const problems = failed > 0 || searchError !== null;
  const didSomething = sent > 0 || created.length > 0;
  return {
    status: !problems ? "succeeded" : didSomething ? "partial" : "failed",
    summary: `${parts.join("; ")}.`,
    errors,
    numbers: { businessesChecked: examined, leadsFound: created.length, emailsSent: sent },
  };
}
