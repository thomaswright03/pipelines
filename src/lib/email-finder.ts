// Finds a contact email on a business's own website — a plain fetch, no
// browser needed, so it works the same locally and on Vercel.
//
// This used to fall back to a Selenium/Google-search scraper when a
// business had no website or nothing findable on it. That fallback is
// gone: it needed local Python + Chrome, which don't exist on Vercel, and
// per-lookup email-finder APIs (Hunter.io etc.) were deliberately skipped
// on cost grounds — see the Cold Outreach/dataleadsell conversation history
// for why. A lead this can't find an email for just has no email; callers
// route it to phone outreach the same way they already do for any other
// "couldn't find one" case.
const FETCH_TIMEOUT_MS = 8000;
const CONTACT_PATHS = ["/contact", "/contact-us"];

const MAILTO_RE = /mailto:([^"'?\s]+)/gi;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const LINK_RE = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
const PLACEHOLDER_ATTR_RE = /placeholder\s*=\s*["'][^"']*["']/gi;
const GENERIC_LOCAL_PARTS = new Set(["info", "hello", "contact", "office", "admin", "support", "team"]);
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

function extractEmails(html: string): string[] {
  const withoutPlaceholders = html.replace(PLACEHOLDER_ATTR_RE, "");

  const found = new Set<string>();
  for (const match of withoutPlaceholders.matchAll(MAILTO_RE)) {
    const email = decodeURIComponent(match[1]!).split("?")[0]!.toLowerCase();
    if (EMAIL_RE.test(email)) found.add(email);
  }
  for (const match of withoutPlaceholders.matchAll(EMAIL_RE)) {
    found.add(match[0].toLowerCase());
  }
  return [...found].filter((e) => !IGNORED_DOMAINS.has(e.split("@")[1] ?? ""));
}

// Finds the site's own "Contact" link on a page (by href or visible text)
// instead of guessing a URL — most sites don't actually live at /contact.
function findContactLink(html: string, base: URL): string | null {
  for (const match of html.matchAll(LINK_RE)) {
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

async function fetchPage(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PipelinesOutreachBot/1.0)" },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("html")) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function findEmailFromWebsite(website: string): Promise<string | null> {
  let base: URL;
  try {
    base = new URL(website);
  } catch {
    return null;
  }

  const candidates: string[] = [];
  const homepage = await fetchPage(base.toString());
  if (homepage) candidates.push(...extractEmails(homepage));

  if (candidates.length === 0 && homepage) {
    const contactLink = findContactLink(homepage, base);
    if (contactLink) {
      const page = await fetchPage(contactLink);
      if (page) candidates.push(...extractEmails(page));
    }
  }

  if (candidates.length === 0) {
    for (const path of CONTACT_PATHS) {
      const page = await fetchPage(new URL(path, base).toString());
      if (page) candidates.push(...extractEmails(page));
      if (candidates.length > 0) break;
    }
  }

  if (candidates.length === 0) return null;

  const counts = new Map<string, number>();
  for (const email of candidates) counts.set(email, (counts.get(email) ?? 0) + 1);

  return [...counts.entries()].sort((a, b) => b[1] + scoreEmail(b[0]) - (a[1] + scoreEmail(a[0])))[0]![0];
}

export async function findEmailForBusiness(website: string | null): Promise<string | null> {
  if (!website) return null;
  return findEmailFromWebsite(website);
}
