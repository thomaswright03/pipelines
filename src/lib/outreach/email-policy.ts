// Which found addresses may be used for which lead.
//
// ADRE and many Yelp listings name an agent *and* their brokerage, and the
// website guess tries the brokerage's name first. The address on a
// brokerage's site is the office's shared inbox (frontdesk@, info@…), not
// the agent's — pitching five agents "Hi <name>" through one front desk is
// exactly what must not happen. So when the site came from the brokerage,
// only an address that is recognisably the agent's own is accepted.

import { rulesVersion } from "@/lib/outreach/rules-version";

const ROLE_LOCAL_PARTS = new Set([
  "info",
  "hello",
  "hi",
  "contact",
  "contactus",
  "office",
  "admin",
  "support",
  "team",
  "frontdesk",
  "reception",
  "sales",
  "marketing",
  "mail",
  "email",
  "inquiries",
  "inquiry",
  "enquiries",
  "service",
  "customerservice",
  "help",
  "noreply",
  "donotreply",
  "webmaster",
  "hr",
  "careers",
  "jobs",
  "billing",
  "accounting",
  "leads",
  "listings",
  "realestate",
  "homes",
  "properties",
  "broker",
  "brokerage",
]);

// Words that make a name-based address a shared or delegated inbox.
const SHARED_SUFFIXES = new Set(["team", "group", "assistant", "asst", "assist", "office", "admin", "ea", "pa", "staff", "desk"]);

/** frontdesk@, info2@, sales.team@ … — an inbox shared by an office, not a person. */
export function isRoleAddress(email: string): boolean {
  const local = (email.split("@")[0] ?? "").toLowerCase();
  const squashed = local.replace(/[^a-z]/g, "");
  if (ROLE_LOCAL_PARTS.has(squashed)) return true;
  const firstToken = local.split(/[._+-]/)[0]!.replace(/\d+$/, "");
  return ROLE_LOCAL_PARTS.has(firstToken);
}

function nameTokens(personName: string): string[] {
  return personName
    .toLowerCase()
    .normalize("NFKD")
    .replace(/['’]/g, "") // O'Neil → oneil
    .replace(/[^a-z\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((t) => t.length >= 2 && !["jr", "sr", "ii", "iii", "iv"].includes(t));
}

/** "Mary-Kate Q. Smith-Jones Jr." → ["mary-kate", "q", "smith-jones"]. */
function nameWords(personName: string): string[] {
  return personName
    .toLowerCase()
    .normalize("NFKD")
    .replace(/['’]/g, "") // O'Neil → oneil
    .replace(/[^a-z\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.replace(/-/g, "") && !["jr", "sr", "ii", "iii", "iv"].includes(w.replace(/-/g, "")));
}

/**
 * The forms of a surname an address may use: "doe"; for a hyphenated
 * surname "smith-jones" also "smithjones", "smith" and "jones".
 */
function surnameForms(personName: string): string[] {
  const words = nameWords(personName);
  const parts = (words[words.length - 1] ?? "").split("-").filter((p) => p.length >= 2);
  const forms = new Set(parts);
  if (parts.length > 1) forms.add(parts.join(""));
  return [...forms];
}

/**
 * Whether the address's local part identifies this specific person: their
 * surname as a whole token together with their first name or first
 * initial — john.doe, john_doe, doe.john, j.doe, jdoe, johndoe, doej,
 * jdoe2. Matching is on whole tokens, never substrings, so for "John Doe"
 * john.smith@, johnson@, john@ and doe.family@ are all rejected: on a
 * brokerage's site those are colleagues or shared inboxes, and each address
 * only ever gets one pitch.
 */
export function addressMatchesPerson(email: string, personName: string): boolean {
  const local = (email.split("@")[0] ?? "").toLowerCase().replace(/\+.*$/, "");
  const tokens = nameTokens(personName);
  if (tokens.length < 2 || !local) return false;
  const first = tokens[0]!;
  const initial = first[0]!;
  const middleInitials = nameWords(personName)
    .slice(1, -1)
    .map((w) => w[0]!);
  const surnames = surnameForms(personName);
  if (surnames.length === 0) return false;

  // Split on separators and digits: "john.doe2" → ["john", "doe"].
  const segments = local.split(/[^a-z]+/).filter(Boolean);
  // jdoe.team@, jdoe.assistant@: an inbox around the person, not theirs.
  if (segments.some((s) => SHARED_SUFFIXES.has(s) || ROLE_LOCAL_PARTS.has(s))) return false;
  const isGiven = (s: string) => s === first || s === initial;

  // Separate tokens: one is the surname, another the first name or initial.
  const surnameAt = segments.findIndex((s) => surnames.includes(s));
  if (surnameAt !== -1 && segments.some((s, j) => j !== surnameAt && isGiven(s))) return true;

  // Run-together forms within one token: johndoe, jdoe, doej, doejohn, jqdoe.
  const joined = new Set<string>();
  for (const last of surnames) {
    for (const given of [first, initial]) {
      joined.add(given + last);
      joined.add(last + given);
      for (const m of middleInitials) joined.add(given + m + last);
    }
  }
  return segments.some((s) => joined.has(s));
}

/**
 * Whether a website's domain carries this person's own name, so the site
 * is theirs rather than their brokerage's: first name or initial run
 * together with the surname (janedoe.com, jdoerealty.com), or the surname
 * as a whole hyphen/dot-separated label (doe-homes.com). A surname merely
 * appearing inside another word (fleetrealty.com for "Ann Lee") doesn't
 * count.
 */
export function hostNamesPerson(hostname: string, personName: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  const tokens = nameTokens(personName);
  if (tokens.length < 2) return false;
  const first = tokens[0]!;
  const surnames = surnameForms(personName);
  const squashed = host.replace(/[^a-z]/g, "");
  if (surnames.some((last) => squashed.includes(first + last) || squashed.startsWith(first[0]! + last))) return true;
  const labels = host.split(/[^a-z]+/).filter(Boolean);
  return labels.some((label) => surnames.includes(label));
}

/**
 * The filter for addresses found on a lead's (possibly guessed) site.
 * `siteBasis` "brokerage" means the site belongs to the lead's brokerage,
 * not to the lead.
 */
export function addressFilterFor(personName: string, siteBasis: "brokerage" | "name" | "given"): (email: string) => boolean {
  if (siteBasis !== "brokerage") return () => true;
  return (email) => !isRoleAddress(email) && addressMatchesPerson(email, personName);
}

/**
 * Identifies this version of the address rules; stored with every address
 * discovery accepts. Bump the revision when the logic changes without a
 * word list changing.
 */
export const ADDRESS_RULES_VERSION = rulesVersion("address", 1, [ROLE_LOCAL_PARTS, SHARED_SUFFIXES]);
