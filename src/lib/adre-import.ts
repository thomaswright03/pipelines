// Works through the Maricopa County ADRE roster a chunk at a time.
//
// loadAdreRoster() downloads and saves the filtered roster (once, then again
// only when it's over ROSTER_MAX_AGE_DAYS old and fully worked through);
// processAdreChunk() checks the next few unchecked licensees in roster
// order, records each one's outcome — including "no email found" — and
// returns progress. The page calls it repeatedly, so every click picks up
// exactly where the last one stopped and no single call nears the 60 s
// function limit.
import { prisma } from "@/lib/db";
import { logError } from "@/lib/log";
import { downloadAdreRoster, parseAdreRoster } from "@/lib/az-adre";
import { createLeadsFromCandidates } from "@/lib/outreach/discovery";

const ADRE_COUNTY = "Maricopa";
const ADRE_STATE = "AZ";
const ROSTER_MAX_AGE_DAYS = 30;
const INSERT_BATCH_SIZE = 1_000;
const ADRE_CHUNK_SIZE = 5;
const CHUNK_TIME_BUDGET_MS = 25_000;
/** A licensee whose website couldn't be reached is tried again after this long. */
const RETRY_AFTER_MS = 60 * 60 * 1000;

/** Unchecked licensees that are due: never tried, or their site was unreachable over an hour ago. */
function dueNow(now: Date) {
  return {
    county: ADRE_COUNTY,
    checkedAt: null,
    OR: [{ lookupFailedAt: null }, { lookupFailedAt: { lt: new Date(now.getTime() - RETRY_AFTER_MS) } }],
  };
}

export type AdreStatus = {
  loaded: boolean;
  loadedAt: Date | null;
  total: number;
  checked: number;
  created: number;
  /** Unchecked licensees that can be checked now. */
  remaining: number;
  /** Unchecked licensees whose website was unreachable within the last hour; checked again after that. */
  retryLater: number;
  /** True when the next click should (re)load the roster first. */
  needsLoad: boolean;
};

export async function getAdreStatus(now: Date = new Date()): Promise<AdreStatus> {
  const [roster, total, checked, created, remaining] = await Promise.all([
    prisma.adreRoster.findUnique({ where: { county: ADRE_COUNTY } }),
    prisma.adreLicensee.count({ where: { county: ADRE_COUNTY } }),
    prisma.adreLicensee.count({ where: { county: ADRE_COUNTY, checkedAt: { not: null } } }),
    prisma.adreLicensee.count({ where: { county: ADRE_COUNTY, outcome: "created" } }),
    prisma.adreLicensee.count({ where: dueNow(now) }),
  ]);
  const retryLater = total - checked - remaining;
  const stale = roster ? now.getTime() - roster.loadedAt.getTime() > ROSTER_MAX_AGE_DAYS * 86_400_000 : true;
  return {
    loaded: roster !== null,
    loadedAt: roster?.loadedAt ?? null,
    total,
    checked,
    created,
    remaining,
    retryLater,
    needsLoad: !roster || (stale && remaining === 0 && retryLater === 0),
  };
}

/**
 * Downloads the roster and adds any licensees not already saved (existing
 * rows keep their checked/outcome state, so a refresh never re-checks
 * anyone). Returns how many were new.
 */
export async function loadAdreRoster(csvText?: string): Promise<{ total: number; added: number }> {
  const text = csvText ?? (await downloadAdreRoster());
  // Throws before anything is saved if the file's format changed or it lists nobody.
  const licensees = parseAdreRoster(text, ADRE_COUNTY);

  const maxPosition = (await prisma.adreLicensee.aggregate({ where: { county: ADRE_COUNTY }, _max: { position: true } }))._max
    .position;
  const offset = (maxPosition ?? -1) + 1;
  let added = 0;
  for (let i = 0; i < licensees.length; i += INSERT_BATCH_SIZE) {
    const batch = licensees.slice(i, i + INSERT_BATCH_SIZE);
    const { count } = await prisma.adreLicensee.createMany({
      data: batch.map((l, j) => ({
        id: l.key,
        county: ADRE_COUNTY,
        position: offset + i + j,
        name: l.name,
        brokerage: l.brokerage,
        phone: l.phone,
        address: l.address,
        city: l.city,
        licenseType: l.licenseType,
      })),
      skipDuplicates: true,
    });
    added += count;
  }

  const total = await prisma.adreLicensee.count({ where: { county: ADRE_COUNTY } });
  await prisma.adreRoster.upsert({
    where: { county: ADRE_COUNTY },
    create: { county: ADRE_COUNTY, loadedAt: new Date(), licenseeCount: total },
    update: { loadedAt: new Date(), licenseeCount: total },
  });
  return { total, added };
}

export type AdreChunkResult = {
  /** Licensees looked at in this chunk, including any whose site couldn't be reached. */
  checked: number;
  created: number;
  unreachable: number;
  status: AdreStatus;
};

/**
 * Checks the next few due licensees, in roster order. One whose website
 * couldn't be reached (timeout, connection error, 5xx) stays unchecked and
 * is tried again an hour later, rather than being written off as "no email".
 */
export async function processAdreChunk(options: { timeBudgetMs?: number; now?: Date } = {}): Promise<AdreChunkResult> {
  const deadline = Date.now() + (options.timeBudgetMs ?? CHUNK_TIME_BUDGET_MS);
  const next = await prisma.adreLicensee.findMany({
    where: dueNow(options.now ?? new Date()),
    orderBy: { position: "asc" },
    take: ADRE_CHUNK_SIZE,
  });

  let checked = 0;
  let created = 0;
  let unreachable = 0;
  for (const licensee of next) {
    if (checked > 0 && Date.now() > deadline) break;
    let outcome = "error";
    let leadId: string | null = null;
    try {
      const result = await createLeadsFromCandidates(
        "dataleadsell",
        [
          {
            name: licensee.name,
            brokerage: licensee.brokerage,
            phone: licensee.phone,
            address: licensee.address,
            city: licensee.city,
            website: null,
            notes: `Licensed ${licensee.licenseType}, active per ADRE.`,
          },
        ],
        {
          city: licensee.city,
          county: ADRE_COUNTY,
          state: ADRE_STATE,
          source: "Arizona ADRE license roster",
          maxCreate: 1,
          deadline: Number.POSITIVE_INFINITY,
        },
      );
      if (result.created[0]) {
        outcome = "created";
        leadId = result.created[0].id;
        created++;
      } else if (result.skipped.existingName) outcome = "existing_name";
      else if (result.skipped.addressInUse) outcome = "address_in_use";
      else if (result.skipped.optedOut) outcome = "opted_out";
      else if (result.skipped.unverifiedSite) outcome = "unverified_site";
      else if (result.skipped.unreachable) outcome = "unreachable";
      else outcome = "no_email";
    } catch (err) {
      logError("adre.processChunk", err, { licenseeId: licensee.id });
    }
    checked++;
    if (outcome === "unreachable") {
      unreachable++;
      await prisma.adreLicensee.update({ where: { id: licensee.id }, data: { lookupFailedAt: new Date(), outcome } });
      continue;
    }
    await prisma.adreLicensee.update({
      where: { id: licensee.id },
      data: { checkedAt: new Date(), outcome, leadId, lookupFailedAt: null },
    });
  }

  return { checked, created, unreachable, status: await getAdreStatus(options.now) };
}
