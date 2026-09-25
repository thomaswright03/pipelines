// Is a guessed website really this lead's?
//
// Yelp and ADRE don't give a website, so discovery guesses one from the
// name (www.<name>.com). A site that merely mentions a word of the name
// ("pizza", "smith") can belong to any business or person with a similar
// name — pitching them wastes the lead's one pitch and risks complaints.
// So an address found on a guessed site is only used when the site also
// shows something we already know about the lead from Yelp/ADRE: its phone
// number, its street address, or its city. The evidence found is saved on
// the lead and shown on its page.
import { digitsOnly, formatPhone } from "@/lib/phone";

export type LeadFacts = {
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

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * The strongest evidence, across the pages fetched from `website`, that the
 * site belongs to the lead — or null when none of the lead's phone, street
 * address or city appears on it.
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
  if (facts.city && showsCity(text, facts.city)) {
    return `Found on ${host}, which mentions the lead's city (${facts.city.trim()}).`;
  }
  return null;
}
