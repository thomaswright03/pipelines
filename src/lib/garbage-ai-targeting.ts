// Who Garbage AI never pitches, and where it never searches (the intake
// form's "Leads who should never be emailed"):
// - haulers already set up in the bot;
// - national and large regional haulers;
// - city and county sanitation / public works departments;
// - any hauler in Mountain High Disposal's service area (Denver metro and
//   Northern Colorado), so the pitch that names them never reaches their
//   direct competitors — and those cities are never the day's city.
// Haulers Cold Outreach already emailed are kept out by the send ledger
// (one pitch per address across pipelines; see send.ts).

/** Mountain High Disposal's service area, all in Colorado. */
export const MOUNTAIN_HIGH_CITIES = [
  "Ault",
  "Aurora",
  "Berthoud",
  "Centennial",
  "Cherry Hills Village",
  "Denver",
  "Eaton",
  "Englewood",
  "Evans",
  "Fort Collins",
  "Galeton",
  "Gill",
  "Gilcrest",
  "Greeley",
  "Johnstown",
  "Kersey",
  "Lakewood",
  "Laporte",
  "LaSalle",
  "Littleton",
  "Loveland",
  "Lucerne",
  "Milliken",
  "Pierce",
  "Severance",
  "Sherrelwood",
  "Timnath",
  "Thornton",
  "Welby",
  "Wellington",
  "Westminster",
  "Windsor",
] as const;

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const AREA = new Set(MOUNTAIN_HIGH_CITIES.map(normalize));

/** Whether a city is in Mountain High's service area (never searched). */
export function isMountainHighCity(city: string, state: string): boolean {
  return state.trim().toUpperCase() === "CO" && AREA.has(normalize(city));
}

const CURRENT_CLIENTS = ["Mountain High Disposal", "Eastern Waste and Recycling", "Garden State Bin Cleaning"].map(normalize);

// The same clients as they'd appear run together in an email domain
// ("office@mountainhighdisposal.com").
const CLIENT_DOMAIN_KEYS = ["mountainhigh", "easternwaste", "gardenstatebin"];

// Matched as whole words in the normalized name. "WM" alone only when it
// is the whole name or a word of its own ("WM of Arizona").
const NATIONAL_HAULERS = [
  "waste management",
  "wm",
  "republic services",
  "waste connections",
  "gfl",
  "gfl environmental",
  "casella",
  "rumpke",
  "waste pro",
  "recology",
];

// City and county departments that show up in searches for haulers.
const PUBLIC_AGENCY = [
  /\b(city|county|town|village|township|borough|parish) of\b/,
  /\bpublic works\b/,
  /\bdepartment\b/,
  /\bdept\b/,
  /\bmunicipal\b/,
  /\b(city|county|municipal|metro) (sanitation|solid waste|refuse|trash|garbage|recycling|waste)\b/,
];

const hasWords = (haystack: string, needle: string) => ` ${haystack} `.includes(` ${needle} `);

/** Why a search result must never be pitched, or null when it may be. */
export function haulerExclusion(candidate: { name: string; address: string | null }): string | null {
  const name = normalize(candidate.name);
  if (CURRENT_CLIENTS.some((client) => hasWords(name, client))) return "already a client";
  if (NATIONAL_HAULERS.some((hauler) => hasWords(name, hauler))) return "national or large regional hauler";
  if (PUBLIC_AGENCY.some((pattern) => pattern.test(name))) return "a city or county department";
  if (candidate.address) {
    // Addresses end "…, Greeley, CO 80631" (the business list's and Yelp's alike).
    const match = candidate.address.match(/,\s*([^,]+?),\s*CO\b/i);
    if (match && AREA.has(normalize(match[1]!))) return "in Mountain High's service area";
  }
  return null;
}

/**
 * Why a saved hauler must never be emailed, or null when it may be — the
 * send gate's last check (send.ts), so a hauler added or edited by hand is
 * held to the same rules as a search result. Beyond haulerExclusion it also
 * looks at the company, the email's domain and the city.
 */
export function pitchExclusion(lead: {
  name: string;
  company: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
}): string | null {
  for (const name of [lead.name, lead.company]) {
    if (!name) continue;
    const reason = haulerExclusion({ name, address: lead.address });
    if (reason) return reason;
  }
  const domain =
    lead.email
      ?.split("@")[1]
      ?.toLowerCase()
      .replace(/[^a-z0-9]/g, "") ?? "";
  if (CLIENT_DOMAIN_KEYS.some((key) => domain.includes(key))) return "already a client";
  if (lead.city && lead.state && isMountainHighCity(lead.city, lead.state)) return "in Mountain High's service area";
  return null;
}
