// Global outbound-email switches (see AppSettings in schema.prisma). Read
// fresh on every send — inside the send's own transaction — so pausing
// takes effect on the very next send, including one already queued in a
// bulk run. Outbound email is paused by the Settings switch (a database
// row) or by the OUTBOUND_EMAIL_DISABLED environment variable, the
// fallback stop for when the app itself can't be reached
// (src/lib/outbound-switch.ts).
import { prisma } from "@/lib/db";
import type { Db } from "@/lib/outreach/pipelines";
import { ENV_PAUSED_MESSAGE, outboundDisabledByEnvironment } from "@/lib/outbound-switch";

const SETTINGS_ID = "global";

type AppSettingsData = {
  /** Nothing may be sent: the Settings switch or the environment says so. */
  outboundPaused: boolean;
  /** What paused it — the environment wins, since the Settings switch can't undo it. */
  pausedBy: "environment" | "settings" | null;
  /** The Settings switch alone (the environment's stop aside). */
  switchPaused: boolean;
  /** When the Settings switch was turned on (null while it is off). */
  pausedAt: Date | null;
  allowCrossPipelineRepeats: boolean;
};

export async function getAppSettings(db: Db = prisma): Promise<AppSettingsData> {
  const byEnvironment = outboundDisabledByEnvironment();
  const row = await db.appSettings.findUnique({ where: { id: SETTINGS_ID } });
  const bySettings = row?.outboundPaused ?? false;
  return {
    outboundPaused: byEnvironment || bySettings,
    pausedBy: byEnvironment ? "environment" : bySettings ? "settings" : null,
    switchPaused: bySettings,
    pausedAt: row?.pausedAt ?? null,
    allowCrossPipelineRepeats: row?.allowCrossPipelineRepeats ?? false,
  };
}

/** Why nothing was sent, for a paused send. */
export function pausedMessage(settings: Pick<AppSettingsData, "pausedBy">): string {
  return settings.pausedBy === "environment" ? ENV_PAUSED_MESSAGE : PAUSED_MESSAGE;
}

export async function setOutboundPaused(paused: boolean, db: Db = prisma): Promise<void> {
  const data = { outboundPaused: paused, pausedAt: paused ? new Date() : null };
  await db.appSettings.upsert({ where: { id: SETTINGS_ID }, create: { id: SETTINGS_ID, ...data }, update: data });
}

export async function setAllowCrossPipelineRepeats(allow: boolean, db: Db = prisma): Promise<void> {
  const data = { allowCrossPipelineRepeats: allow };
  await db.appSettings.upsert({ where: { id: SETTINGS_ID }, create: { id: SETTINGS_ID, ...data }, update: data });
}

const PAUSED_MESSAGE = "Outbound email is paused (see Settings) — nothing was sent.";

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

type ServiceCheck = { at: Date; error: string | null };

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
