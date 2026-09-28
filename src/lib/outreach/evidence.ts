// The wording of an address's evidence when a person, not the lookup,
// vouched for it. Shared so "was this address found automatically?" can be
// answered from the evidence text.
import { formatDate } from "@/lib/time";

export const ENTERED_BY_HAND_PREFIX = "Entered by hand";
/** The evidence saved when a person confirmed an address the lookup found ("Address checked — allow sending"). */
export const CHECKED_BY_HAND_PREFIX = "Checked by hand";

/** The note saved as an address's evidence when a person typed it in. */
export function enteredByHandEvidence(at: Date = new Date()): string {
  return `${ENTERED_BY_HAND_PREFIX} on ${formatDate(at)}.`;
}
