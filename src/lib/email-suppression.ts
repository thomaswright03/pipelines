// A recipient's opt-out (see SuppressedEmail in schema.prisma) has to
// actually block every future send, not just the pipeline they replied
// through — both pipelines currently send from the same address, so a
// "STOP" reply covers all outreach from that address, not just one.
import { prisma } from "@/lib/db";

const STOP_RE = /\b(stop|unsubscribe|remove\s*me|opt[\s-]?out)\b/i;

export function textRequestsOptOut(text: string): boolean {
  return STOP_RE.test(text);
}

export async function isSuppressed(email: string): Promise<boolean> {
  const row = await prisma.suppressedEmail.findUnique({ where: { email: email.toLowerCase() } });
  return row !== null;
}

export async function suppressEmail(email: string, reason: string): Promise<void> {
  await prisma.suppressedEmail.upsert({
    where: { email: email.toLowerCase() },
    create: { email: email.toLowerCase(), reason },
    update: {},
  });
}
