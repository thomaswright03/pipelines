// The fixed development / held-out split for exported evaluation cases
// (scripts/export-eval-cases.mjs, docs/measuring-rules.md). Shared with
// tests/heuristics-eval.test.ts, which checks that every case in the
// frozen held-out file and in the real development list sits in the split
// its id assigns, so nobody chooses which cases are held out.
import { createHash } from "node:crypto";

/** Share of cases assigned to the development split; the rest are held out. */
export const DEV_SHARE = 0.4;

/** A case's id: the first 16 hex digits of a SHA-256 of its anonymised text, as exported (before any hand edits). */
export function caseId(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/** "dev" or "held-out", fixed by the case's id. */
export function splitForId(id) {
  if (!/^[0-9a-f]{16}$/.test(id)) throw new Error(`Not an exported case id: ${JSON.stringify(id)}`);
  return Number.parseInt(id.slice(0, 2), 16) < DEV_SHARE * 256 ? "dev" : "held-out";
}
