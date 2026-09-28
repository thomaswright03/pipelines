// A short, stable fingerprint of a pitch template's wording, stored with
// every send (EmailSendLog.templateVersion) so reply rates can be compared
// across copy changes. It's derived from the template itself — rendered
// with placeholder inputs — so any change to the subject or body gives a
// new version without anyone remembering to bump a number.
import { createHash } from "node:crypto";

/** "cold-outreach-3f9a2c1d": the pipeline and the first 8 hex digits of a SHA-256 of the rendered samples. */
export function templateVersion(prefix: string, samples: { subject: string; body: string }[]): string {
  const hash = createHash("sha256");
  for (const { subject, body } of samples) hash.update(subject).update("\0").update(body).update("\0");
  return `${prefix}-${hash.digest("hex").slice(0, 8)}`;
}
