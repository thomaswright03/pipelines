// Global outbound-email switches (see AppSettings in schema.prisma). Read
// fresh on every send — inside the send's own transaction — so pausing
// takes effect on the very next send, including one already queued in a
// bulk run.
import { prisma } from "@/lib/db";
import type { Db } from "@/lib/outreach/pipelines";

const SETTINGS_ID = "global";

export type AppSettingsData = {
  outboundPaused: boolean;
  pausedAt: Date | null;
  allowCrossPipelineRepeats: boolean;
};

const DEFAULTS: AppSettingsData = { outboundPaused: false, pausedAt: null, allowCrossPipelineRepeats: false };

export async function getAppSettings(db: Db = prisma): Promise<AppSettingsData> {
  const row = await db.appSettings.findUnique({ where: { id: SETTINGS_ID } });
  if (!row) return DEFAULTS;
  return {
    outboundPaused: row.outboundPaused,
    pausedAt: row.pausedAt,
    allowCrossPipelineRepeats: row.allowCrossPipelineRepeats,
  };
}

export async function setOutboundPaused(paused: boolean, db: Db = prisma): Promise<void> {
  const data = { outboundPaused: paused, pausedAt: paused ? new Date() : null };
  await db.appSettings.upsert({ where: { id: SETTINGS_ID }, create: { id: SETTINGS_ID, ...data }, update: data });
}

export async function setAllowCrossPipelineRepeats(allow: boolean, db: Db = prisma): Promise<void> {
  const data = { allowCrossPipelineRepeats: allow };
  await db.appSettings.upsert({ where: { id: SETTINGS_ID }, create: { id: SETTINGS_ID, ...data }, update: data });
}

export const PAUSED_MESSAGE = "Outbound email is paused (see Settings) — nothing was sent.";

/** Remembers the latest failed send, for Settings → Connections. Best-effort: never throws. */
export async function recordSendFailure(message: string, at: Date = new Date(), db: Db = prisma): Promise<void> {
  const data = { lastSendFailedAt: at, lastSendFailure: message.slice(0, 500) };
  try {
    await db.appSettings.upsert({ where: { id: SETTINGS_ID }, create: { id: SETTINGS_ID, ...data }, update: data });
  } catch {
    // The send's own outcome is what matters; this is only for the status view.
  }
}

export async function lastSendFailure(db: Db = prisma): Promise<{ at: Date; message: string | null } | null> {
  const row = await db.appSettings.findUnique({ where: { id: SETTINGS_ID }, select: { lastSendFailedAt: true, lastSendFailure: true } });
  return row?.lastSendFailedAt ? { at: row.lastSendFailedAt, message: row.lastSendFailure } : null;
}

export type ServiceCheck = { at: Date; error: string | null };

/**
 * Remembers the outcome of the latest contact with an outside service, for
 * Settings → Connections: `error` null means it answered. Best-effort:
 * never throws.
 */
export async function recordServiceCheck(
  service: "mail" | "yelp",
  error: string | null,
  at: Date = new Date(),
  db: Db = prisma,
): Promise<void> {
  const data =
    service === "mail"
      ? { mailTestedAt: at, mailTestError: error?.slice(0, 500) ?? null }
      : { yelpCheckedAt: at, yelpCheckError: error?.slice(0, 500) ?? null };
  try {
    await db.appSettings.upsert({ where: { id: SETTINGS_ID }, create: { id: SETTINGS_ID, ...data }, update: data });
  } catch {
    // Only for the status view.
  }
}

export async function lastServiceChecks(db: Db = prisma): Promise<{ mail: ServiceCheck | null; yelp: ServiceCheck | null }> {
  const row = await db.appSettings.findUnique({
    where: { id: SETTINGS_ID },
    select: { mailTestedAt: true, mailTestError: true, yelpCheckedAt: true, yelpCheckError: true },
  });
  return {
    mail: row?.mailTestedAt ? { at: row.mailTestedAt, error: row.mailTestError } : null,
    yelp: row?.yelpCheckedAt ? { at: row.yelpCheckedAt, error: row.yelpCheckError } : null,
  };
}
