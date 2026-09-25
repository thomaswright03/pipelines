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
