// Outreach copy for the dataleadsell.com pipeline, written by Thomas: a
// casual note to real estate agents about the obituary-matching lead tool.
// Used for every send (single, bulk) and for the preview on each agent's page.

// CAN-SPAM requires a valid physical postal address on commercial email.
import { OUTREACH_MAILING_ADDRESS } from "@/lib/outreach-mailing-address";
import { templateVersion } from "@/lib/email-template-version";
import {
  DATALEADSELL_BROKERAGE,
  DATALEADSELL_BUSINESS_NAME,
  DATALEADSELL_COUNTY_STATUS,
  DATALEADSELL_PHONE,
  DATALEADSELL_SIGNER,
} from "@/lib/dataleadsell-config";

// Words that mean a listing is a team or company, not a person — "Hi
// Realty," would be worse than "Hi there,".
const NOT_A_PERSON =
  /\b(realty|realtors?|real estate|group|team|homes|properties|property|partners|associates|brokerage|llc|inc|co|company|agency|office|services|investments|estates?)\b/i;
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

export function buildAgentOutreachEmail(agentName: string, county: string | null): { subject: string; body: string } {
  const countyLabel = county ? `${county} County` : "your county";
  const status = (county && DATALEADSELL_COUNTY_STATUS[county]) || "still open";
  const signoff = [DATALEADSELL_BROKERAGE, DATALEADSELL_PHONE].filter(Boolean).join(" | ");

  const subject = `quick question about ${countyLabel}`;

  const body = [
    `Hey ${greetingName(agentName) ?? "there"},`,
    ``,
    `${DATALEADSELL_SIGNER} here, I’m an agent in ${countyLabel} too. I built something I think you’d like and wanted to run it by you.`,
    ``,
    `A lot of the best listings start with a life event, and by the time they hit the MLS everyone has already seen them. So I built a tool that checks obituary notices against county property records every night. It shows me which homes might be coming up for sale before anyone else is talking to the family. It also mails a personal letter for me, so I’m not stuffing envelopes.`,
    ``,
    `I’m now offering it to a few other agents. Each county gets one buyer, so you wouldn’t be fighting another agent over the same list. Letters run about 73 cents each.`,
    ``,
    `One heads up: it’s matched off public records, so I always look over a lead before I send anything. It’s a head start, not a guarantee.`,
    ``,
    `${capitalize(countyLabel)} is ${status}. Want me to show you how it works? Takes 10 minutes.`,
    ``,
    DATALEADSELL_SIGNER,
    signoff,
    `dataleadsell.com`,
    ``,
    `${DATALEADSELL_BUSINESS_NAME} · ${OUTREACH_MAILING_ADDRESS}`,
    `Not interested? Just reply “unsubscribe” and I’ll take you off.`,
  ].join("\n");

  return { subject, body };
}

function capitalize(text: string): string {
  return text[0]!.toUpperCase() + text.slice(1);
}

/** Which wording a send used (stored with it); changes whenever the template's text or a county's status does. */
export const DATALEADSELL_TEMPLATE_VERSION = templateVersion(
  "dataleadsell",
  [null, ...Object.keys(DATALEADSELL_COUNTY_STATUS)].map((county) => buildAgentOutreachEmail("{agent}", county)),
);
