// A recipient's opt-out (see SuppressedEmail in schema.prisma) blocks every
// future send from both pipelines, not just the one they replied to — both
// send from the same business identity.
import { prisma } from "@/lib/db";
import type { Db } from "@/lib/outreach/pipelines";

type SuppressionSource = "inbound_reply" | "manual";

type Suppression = {
  email: string;
  reason: string | null;
  source: string | null;
  evidence: string | null;
  createdAt: Date;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function getSuppression(email: string, db: Db = prisma): Promise<Suppression | null> {
  return db.suppressedEmail.findUnique({ where: { email: normalizeEmail(email) } });
}

export async function suppressEmail(
  email: string,
  details: { reason: string; source: SuppressionSource; evidence?: string | null },
  db: Db = prisma,
): Promise<void> {
  const normalized = normalizeEmail(email);
  await db.suppressedEmail.upsert({
    where: { email: normalized },
    create: { email: normalized, reason: details.reason, source: details.source, evidence: details.evidence ?? null },
    // An existing opt-out is never weakened; the first record stands.
    update: {},
  });
}

/** Removes an opt-out. Only ever called from an explicit operator action. */
export async function unsuppressEmail(email: string, db: Db = prisma): Promise<boolean> {
  const { count } = await db.suppressedEmail.deleteMany({ where: { email: normalizeEmail(email) } });
  return count > 0;
}
