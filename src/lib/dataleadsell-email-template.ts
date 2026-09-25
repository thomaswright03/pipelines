// Outreach copy for the dataleadsell.com pipeline — pitching a Probate
// Property Leads subscription to real estate agents. Used for every send
// (single, bulk) and for the preview on each agent's page.

// CAN-SPAM requires a valid physical postal address on commercial email.
import { OUTREACH_MAILING_ADDRESS } from "@/lib/outreach-mailing-address";

const COUNTY_PRICING: Record<string, string> = {
  Maricopa: "$500/mo",
  "Salt Lake": "$300/mo",
  Utah: "$175/mo",
};

// Words that mean a listing is a team or company, not a person — "Hi
// Realty," would be worse than "Hi there,".
const NOT_A_PERSON = /\b(realty|realtors?|real estate|group|team|homes|properties|property|partners|associates|brokerage|llc|inc|co|company|agency|office|services|investments|estates?)\b/i;
const HONORIFICS = new Set(["mr", "mrs", "ms", "miss", "dr", "prof"]);

function titleCase(word: string): string {
  return word
    .toLowerCase()
    .split(/([-'’])/)
    .map((part) => (part.length > 0 && !/[-'’]/.test(part) ? part[0]!.toUpperCase() + part.slice(1) : part))
    .join("");
}

/**
 * The first name to greet an agent by, from however the listing names them:
 * "JANE M DOE - Keller Williams Realty" → "Jane", "Doe, Jane" → "Jane",
 * "Dr. Pat O'NEIL" → "Pat". Null when there's no reliable first name
 * (a team or company name, initials only).
 */
export function greetingName(rawName: string | null | undefined): string | null {
  if (!rawName) return null;
  // "Person - Brokerage" / "Person | Brokerage" → the person part.
  let person = rawName.split(/\s+[-–|·]\s+/)[0]!.trim();
  // Roster style "Last, First Middle".
  const comma = person.match(/^([^,]+),\s*(.+)$/);
  if (comma && !/^(jr|sr|ii|iii|iv)\.?$/i.test(comma[2]!.trim())) person = comma[2]!;
  if (NOT_A_PERSON.test(person)) return null;

  const words = person
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}'’-]/gu, ""))
    .filter(Boolean)
    .filter((w) => !HONORIFICS.has(w.toLowerCase()));
  // Skip leading initials ("J. Michael Smith" → "Michael").
  const first = words.find((w) => w.replace(/[-'’]/g, "").length > 1);
  if (!first) return null;
  return titleCase(first);
}

export function buildAgentOutreachEmail(
  agentName: string,
  county: string | null,
): { subject: string; body: string } {
  const countyLabel = county ? `${county} County` : "your county";
  const price = county ? COUNTY_PRICING[county] : undefined;
  const priceLine = price ? ` — ${price} for ${countyLabel}` : "";

  const subject = `Probate leads in ${countyLabel} before your competitors see them`;

  const body = [
    `Hi ${greetingName(agentName) ?? "there"},`,
    ``,
    `I run Data Lead Sell — we track new probate filings in ${countyLabel}, cross-check the property owner's name against the deceased's obituary to confirm it's a real, sellable lead, and hand you a list of verified probate property leads every week, plus optional pre-designed letters mailed straight to the heirs.`,
    ``,
    `These are motivated sellers most agents never hear about until a wholesaler or another agent already has the listing.`,
    ``,
    `Access is a monthly subscription by county${priceLine}, no long-term contract — cancel anytime.`,
    ``,
    `Take a look at dataleadsell.com and see this week's confirmed leads for ${countyLabel}. Happy to answer any questions — just reply to this email.`,
    ``,
    `Thomas Wright`,
    `(801) 580-8630`,
    `Data Lead Sell — Wright AI Solutions, LLC`,
    `${OUTREACH_MAILING_ADDRESS}`,
    `dataleadsell.com`,
    ``,
    `Don't want to hear from us again? Reply STOP and we won't email you again.`,
  ].join("\n");

  return { subject, body };
}
