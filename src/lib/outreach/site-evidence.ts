// Is a guessed website really this lead's?
//
// Yelp and ADRE don't give a website, so discovery guesses one from the
// name (www.<name>.com). A site that merely mentions a word of the name
// ("pizza", "smith") can belong to any business or person with a similar
// name — pitching them wastes the lead's one pitch and risks complaints.
// So an address found on a guessed site is only used when the site also
// shows something we already know about the lead from Yelp/ADRE: its phone
// number or its street address. A mention of the lead's city alone isn't
// enough — a chain, a franchise or a same-named business in the same big
// city passes that — so the city only counts together with a second,
// independent signal — the lead's distinctive name word(s) in the page's own
// title, or an address that carries the lead's own name (an agent on their
// brokerage's site) — on a site that doesn't list other locations. The evidence found is
// saved on the lead and shown on its page.
//
// tests/heuristics-eval.test.ts scores this on a labelled set of guessed
// sites (tests/corpus/sites.ts).
import { digitsOnly, formatPhone } from "@/lib/phone";

export type LeadFacts = {
  /** The lead's name as Yelp/ADRE gave it, for the page-title check. */
  name?: string | null;
  /**
   * The address found is recognisably the lead's own (an agent's name on
   * their brokerage's site — see email-policy.ts): a name signal like the
   * page title.
   */
  addressNamesLead?: boolean;
  phone: string | null;
  address: string | null;
  city: string | null;
};

/** Visible text of a page, lower-cased, tags and entities flattened to spaces. */
function pageText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whether the page shows this 10-digit number in any common format (incl. tel: links). */
function showsPhone(html: string, phone: string): boolean {
  const digits = digitsOnly(phone);
  if (digits.length !== 10) return false;
  // "(480) 555-0101", "480.555.0101", "+1 480 555 0101", "tel:+14805550101"
  const [a, b, c] = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6)];
  const sep = "[\\s().\\-\\u00a0]*";
  const re = new RegExp(`(?<!\\d)(?:\\+?1${sep})?\\(?${a}\\)?${sep}${b}${sep}${c}(?!\\d)`);
  return re.test(html.replace(/&nbsp;|&#160;/gi, " "));
}

/** "1234 N Main St, Phoenix, AZ 85001" → house number 1234, street word "main". */
function streetKey(address: string): { number: string; street: string } | null {
  const match = address
    .trim()
    .toLowerCase()
    .match(/^(\d+[a-z]?)\s+(?:(?:n|s|e|w|north|south|east|west)\.?\s+)?([a-z0-9]+)/);
  if (!match) return null;
  const street = match[2]!;
  // "123 Suite …" or a bare number isn't a street to match on.
  if (street.length < 2 || /^(suite|ste|unit|apt)$/.test(street)) return null;
  return { number: match[1]!, street };
}

function showsStreet(text: string, address: string): boolean {
  const key = streetKey(address);
  if (!key) return false;
  const re = new RegExp(
    `(?<![\\d])${escapeRegExp(key.number)}\\s+(?:(?:n|s|e|w|north|south|east|west)\\.?\\s+)?${escapeRegExp(key.street)}\\b`,
  );
  return re.test(text);
}

function showsCity(text: string, city: string): boolean {
  const c = city.trim().toLowerCase().replace(/\s+/g, " ");
  if (c.length < 3) return false;
  return new RegExp(`\\b${escapeRegExp(c)}\\b`).test(text);
}

// Words that say what a business is rather than which one it is: seeing
// "Pizza" in a pizza place's title says nothing about whose site it is.
const GENERIC_NAME_WORDS = new Set(
  (
    "the and of for at by in on llc inc co corp company ltd pllc pc group team services service solutions " +
    "pizza pizzeria restaurant cafe coffee bar grill kitchen bakery deli market shop store boutique salon spa barber " +
    "plumbing plumber hvac heating cooling air electric electrical roofing landscaping cleaning construction contractors " +
    "auto repair dental dentist clinic medical law firm agency studio center centre fitness gym home homes house " +
    "realty real estate properties property realtor realtors broker brokerage associates partners international " +
    "llp mortgage insurance tax accounting care pets pet vet veterinary"
  ).split(" "),
);

/** "Joe's Pizza LLC" → ["joe"]: the name words that identify this business. */
function distinctiveNameWords(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !GENERIC_NAME_WORDS.has(w) && !/^\d+$/.test(w));
}

/** The page's own title (and og:site_name), lower-cased. */
function pageTitles(html: string): string {
  const titles = [...html.matchAll(/<title[^>]*>([\s\S]*?)<\/title>/gi)].map((m) => m[1]!);
  const siteNames = [...html.matchAll(/<meta[^>]+property=["']og:site_name["'][^>]*content=["']([^"']*)["']/gi)].map((m) => m[1]!);
  return [...titles, ...siteNames].join(" ").replace(/&amp;/gi, "&").replace(/&#0?39;|&apos;|’/gi, "'").toLowerCase();
}

// A site that lists more than one location (a chain, a franchise) can't be
// tied to one lead by the city alone.
const MULTI_LOCATION_RE =
  /\b(?:our\s+locations|all\s+locations|other\s+locations|find\s+a\s+location|choose\s+(?:a|your)\s+location|locations\s+near\s+you|store\s+locator|location\s+finder|franchis(?:e|es|ing|ee|ees)|nationwide)\b/;

function titleNamesLead(html: string, name: string | null | undefined): boolean {
  if (!name) return false;
  const words = distinctiveNameWords(name);
  if (words.length === 0) return false;
  const title = pageTitles(html).replace(/'s\b/g, "");
  return words.every((w) => new RegExp(`\\b${escapeRegExp(w)}\\b`).test(title));
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * The strongest evidence, across the pages fetched from `website`, that the
 * site belongs to the lead — or null when it shows neither the lead's phone
 * nor street address, and not the city together with the lead's name in the
 * page title.
 */
export function siteEvidence(website: string, pages: string[], facts: LeadFacts): string | null {
  if (pages.length === 0) return null;
  const host = hostOf(website);
  const html = pages.join("\n");
  const text = pageText(html);

  if (facts.phone && showsPhone(html, facts.phone)) {
    return `Found on ${host}, which shows the lead's phone number ${formatPhone(facts.phone)}.`;
  }
  if (facts.address && showsStreet(text, facts.address)) {
    return `Found on ${host}, which shows the lead's street address (${facts.address.split(",")[0]!.trim()}).`;
  }
  if (facts.city && showsCity(text, facts.city) && !MULTI_LOCATION_RE.test(text)) {
    const city = facts.city.trim();
    if (titleNamesLead(html, facts.name)) {
      return `Found on ${host}, which is titled with the lead's name and mentions the lead's city (${city}), with no other locations listed.`;
    }
    if (facts.addressNamesLead) {
      return `Found on ${host}, which mentions the lead's city (${city}) with no other locations listed; the address carries the lead's own name.`;
    }
  }
  return null;
}
