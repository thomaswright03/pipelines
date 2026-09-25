// Finds a contact email on a business's own website — a plain fetch, no
// browser needed, so it works the same locally and on Vercel.
//
// This used to fall back to a Selenium/Google-search scraper when a
// business had no website or nothing findable on it. That fallback is
// gone: it needed local Python + Chrome, which don't exist on Vercel, and
// per-lookup email-finder APIs (Hunter.io etc.) were deliberately skipped
// on cost grounds. A lead this can't find an email for just has no email;
// callers route it to phone outreach — but only when the site was actually
// read. A site that timed out or errored is reported as `unreachable`, so
// the lead is left alone and tried again later.
import { classifyFetchError, classifyStatus, type FetchFailure } from "@/lib/fetch-failure";

const FETCH_TIMEOUT_MS = 8000;
const CONTACT_PATHS = ["/contact", "/contact-us"];

// Every regex here is either non-global or built fresh per call. A shared
// `/g` regex carries `lastIndex` between calls (`.test()` advances it, and
// `matchAll` copies it when cloning), which once made the next page's scan
// start mid-text and save "ner@zetaroofing.test" for "owner@zetaroofing.test".
const MAILTO_PATTERN = /mailto:([^"'?\s>]+)/.source;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/.source;
const EMAIL_EXACT_RE = new RegExp(`^${EMAIL_PATTERN}$`);
const LINK_PATTERN = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/.source;
const PLACEHOLDER_ATTR_PATTERN = /placeholder\s*=\s*["'][^"']*["']/.source;
const GENERIC_LOCAL_PARTS = new Set(["info", "hello", "contact", "office", "admin", "support", "team"]);
// "logo@2x.png"-style asset names look like addresses to the pattern above.
const ASSET_TLDS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "avif", "css", "js", "ico", "bmp", "tif", "tiff"]);
// Template/boilerplate placeholders left over on never-customized sites
// ("user@domain.com", "you@example.com" in visible copy, not just a form
// hint) — these are valid-looking emails that don't belong to anyone.
const IGNORED_DOMAINS = new Set([
  "example.com",
  "sentry.io",
  "wixpress.com",
  "godaddy.com",
  "domain.com",
  "yourdomain.com",
  "mydomain.com",
  "yoursite.com",
  "mysite.com",
  "yourcompany.com",
  "yourwebsite.com",
  "email.com",
  "test.com",
  "sample.com",
  "company.com",
  "website.com",
  "emailaddress.com",
]);

function scoreEmail(email: string): number {
  const local = email.split("@")[0]!;
  let score = 0;
  if (/^\d+$/.test(local)) score -= 5; // looks like an auto-generated/tracking ID, not a real contact
  if (GENERIC_LOCAL_PARTS.has(local)) score += 2;
  return score;
}

function isUsableAddress(email: string): boolean {
  if (!EMAIL_EXACT_RE.test(email)) return false;
  const domain = email.split("@")[1] ?? "";
  const tld = domain.split(".").pop() ?? "";
  return !IGNORED_DOMAINS.has(domain) && !ASSET_TLDS.has(tld);
}

/**
 * Every distinct, plausible email address in a page's HTML (mailto links
 * and plain text), lower-cased. Stateless: the result depends only on
 * `html`, never on what was extracted before.
 */
export function extractEmails(html: string): string[] {
  const withoutPlaceholders = html.replace(new RegExp(PLACEHOLDER_ATTR_PATTERN, "gi"), "");

  const found = new Set<string>();
  for (const match of withoutPlaceholders.matchAll(new RegExp(MAILTO_PATTERN, "gi"))) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(match[1]!);
    } catch {
      decoded = match[1]!;
    }
    const email = decoded.split("?")[0]!.trim().toLowerCase();
    if (isUsableAddress(email)) found.add(email);
  }
  for (const match of withoutPlaceholders.matchAll(new RegExp(EMAIL_PATTERN, "g"))) {
    const email = match[0].toLowerCase().replace(/\.+$/, "");
    if (isUsableAddress(email)) found.add(email);
  }
  return [...found];
}

// Finds the site's own "Contact" link on a page (by href or visible text)
// instead of guessing a URL — most sites don't actually live at /contact.
function findContactLink(html: string, base: URL): string | null {
  for (const match of html.matchAll(new RegExp(LINK_PATTERN, "gi"))) {
    const href = match[1]!;
    const text = match[2]!.replace(/<[^>]+>/g, "").trim();
    if (!/contact/i.test(href) && !/contact/i.test(text)) continue;
    try {
      const resolved = new URL(href, base);
      if (resolved.protocol === "http:" || resolved.protocol === "https:") return resolved.toString();
    } catch {
      continue;
    }
  }
  return null;
}

type PageResult = { html: string; failure: null } | { html: null; failure: FetchFailure };

async function fetchPage(url: string, outer?: AbortSignal): Promise<PageResult> {
  if (outer?.aborted) return { html: null, failure: "unreachable" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: outer ? AbortSignal.any([controller.signal, outer]) : controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PipelinesOutreachBot/1.0)" },
    });
    if (!res.ok) return { html: null, failure: classifyStatus(res.status) };
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("html")) return { html: null, failure: "missing" };
    return { html: await res.text(), failure: null };
  } catch (err) {
    return { html: null, failure: classifyFetchError(err) };
  } finally {
    clearTimeout(timer);
  }
}

export type WebsiteScan = {
  /** Every plausible address on the site, best first. */
  emails: string[];
  /** The HTML of every page that was fetched, so callers can check whose site it is. */
  pages: string[];
  /**
   * True when the homepage couldn't be reached (timeout, connection error,
   * 5xx) and no page was read at all: the scan says nothing about whether
   * the site lists an address.
   */
  unreachable: boolean;
};

/**
 * Every plausible address on a business's site (homepage, then its own
 * Contact link, then /contact and /contact-us), best first: addresses that
 * appear on more pages and generic business inboxes rank higher,
 * numeric-looking tracking ids lower. Also returns the pages it read.
 */
export async function scanWebsite(website: string, signal?: AbortSignal): Promise<WebsiteScan> {
  let base: URL;
  try {
    base = new URL(website);
  } catch {
    return { emails: [], pages: [], unreachable: false };
  }

  const pages: string[] = [];
  const candidates: string[] = [];
  const read = async (url: string) => {
    const result = await fetchPage(url, signal);
    if (result.html) {
      pages.push(result.html);
      candidates.push(...extractEmails(result.html));
    }
    return result;
  };

  const home = await read(base.toString());
  const homepage = home.html;

  if (candidates.length === 0 && homepage) {
    const contactLink = findContactLink(homepage, base);
    if (contactLink) await read(contactLink);
  }

  if (candidates.length === 0) {
    for (const path of CONTACT_PATHS) {
      await read(new URL(path, base).toString());
      if (candidates.length > 0) break;
    }
  }

  const counts = new Map<string, number>();
  for (const email of candidates) counts.set(email, (counts.get(email) ?? 0) + 1);

  const emails = [...counts.entries()].sort((a, b) => b[1] + scoreEmail(b[0]) - (a[1] + scoreEmail(a[0]))).map(([email]) => email);
  return { emails, pages, unreachable: home.failure === "unreachable" && pages.length === 0 };
}
