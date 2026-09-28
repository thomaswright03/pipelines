// Plain-words names for the versions of a pipeline's pitch. Every send
// stores a fingerprint of the wording it used (email-template-version.ts,
// "cold-outreach-d4f4b322"); the operator sees "Email version 2 (in use
// since Sep 20, 2026)" instead, numbered in the order each version was
// first sent. The fingerprint stays in the data.
import { prisma } from "@/lib/db";
import type { PipelineId } from "@/lib/outreach/pipeline-id";
import { formatDate } from "@/lib/time";

export type VersionHistory = Map<string, { number: number; since: Date }>;

/** Each recorded version's number (1 = the first one sent) and when it was first sent. */
export async function templateVersionHistory(pipeline: PipelineId): Promise<VersionHistory> {
  const where = { templateVersion: { not: null } };
  const rows =
    pipeline === "dataleadsell"
      ? await prisma.emailSendLog.groupBy({ by: ["templateVersion"], where, _min: { sentAt: true } })
      : pipeline === "garbage-ai"
        ? await prisma.haulerEmailSendLog.groupBy({ by: ["templateVersion"], where, _min: { sentAt: true } })
        : await prisma.leadEmailSendLog.groupBy({ by: ["templateVersion"], where, _min: { sentAt: true } });
  return numberVersions(rows.map((r) => ({ version: r.templateVersion, firstSent: r._min.sentAt })));
}

/** Numbers versions by when each was first sent, oldest first. */
export function numberVersions(rows: { version: string | null; firstSent: Date | null }[]): VersionHistory {
  const dated = rows
    .filter((r): r is { version: string; firstSent: Date } => r.version !== null && r.firstSent !== null)
    .sort((a, b) => a.firstSent.getTime() - b.firstSent.getTime());
  return new Map(dated.map((r, i) => [r.version, { number: i + 1, since: r.firstSent }]));
}

/**
 * "Email version 2 (in use since Sep 20, 2026)", "Email version 3 (the
 * current wording, not sent yet)", or — for sends recorded before versions
 * were — "Sent before email versions were recorded".
 */
export function describeTemplateVersion(version: string | null, history: VersionHistory, current?: string): string {
  if (!version) return "Sent before email versions were recorded";
  const known = history.get(version);
  if (!known) return `Email version ${history.size + 1} (${version === current ? "the current wording, " : ""}not sent yet)`;
  const since = `in use since ${formatDate(known.since)}`;
  if (current === undefined) return `Email version ${known.number} (first sent ${formatDate(known.since)})`;
  return `Email version ${known.number} (${version === current ? since : `an earlier wording, first sent ${formatDate(known.since)}`})`;
}
