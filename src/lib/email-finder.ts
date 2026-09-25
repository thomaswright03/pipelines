// Finds a contact email on a business's own website — a plain fetch, no
// browser needed, so it works the same locally and on Vercel.
//
// This used to fall back to a Selenium/Google-search scraper when a
// business had no website or nothing findable on it. That fallback is
// gone: it needed local Python + Chrome, which don't exist on Vercel, and
// per-lookup email-finder APIs (Hunter.io etc.) were deliberately skipped
// on cost grounds. A lead this can't find an email for just has no email; callers
// route it to phone outreach the same way they already do for any other
// "couldn't find one" case.
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

async function fetchPage(url: string, outer?: AbortSignal): Promise<string | null> {
  if (outer?.aborted) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: outer ? AbortSignal.any([controller.signal, outer]) : controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PipelinesOutreachBot/1.0)" },
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("html")) return null;
    return await res.text();
  } catch {
    // Unreachable site, timeout, TLS failure — all mean "no email here".
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Every plausible address on a business's site (homepage, then its own
 * Contact link, then /contact and /contact-us), best first: addresses that
 * appear on more pages and generic business inboxes rank higher,
 * numeric-looking tracking ids lower.
 */
export async function findEmailCandidatesOnWebsite(website: string, signal?: AbortSignal): Promise<string[]> {
  let base: URL;
  try {
    base = new URL(website);
  } catch {
    return [];
  }

  const candidates: string[] = [];
  const homepage = await fetchPage(base.toString(), signal);
  if (homepage) candidates.push(...extractEmails(homepage));

  if (candidates.length === 0 && homepage) {
    const contactLink = findContactLink(homepage, base);
    if (contactLink) {
      const page = await fetchPage(contactLink, signal);
      if (page) candidates.push(...extractEmails(page));
    }
  }

  if (candidates.length === 0) {
    for (const path of CONTACT_PATHS) {
      const page = await fetchPage(new URL(path, base).toString(), signal);
      if (page) candidates.push(...extractEmails(page));
      if (candidates.length > 0) break;
    }
  }

  const counts = new Map<string, number>();
  for (const email of candidates) counts.set(email, (counts.get(email) ?? 0) + 1);

  return [...counts.entries()]
    .sort((a, b) => b[1] + scoreEmail(b[0]) - (a[1] + scoreEmail(a[0])))
    .map(([email]) => email);
}

/**
 * The best address on the site that `accept` allows (every address, if no
 * filter is given), or null.
 */
export async function findEmailForBusiness(
  website: string | null,
  accept: (email: string) => boolean = () => true,
  signal?: AbortSignal,
): Promise<string | null> {
  if (!website) return null;
  const candidates = await findEmailCandidatesOnWebsite(website, signal);
  return candidates.find(accept) ?? null;
}
