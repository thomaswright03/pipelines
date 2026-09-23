// Guesses a business's website from its name alone — no search engine
// involved. DuckDuckGo's plain HTML results endpoint (the free, no-JS
// option that would normally do this) was tried first and presents an
// explicit bot CAPTCHA ("Unfortunately, bots use DuckDuckGo too") for
// automated requests — the same category of block already ruled out for
// Realtor.com/Zillow, so scraping any search engine is off the table for
// the same reason.
//
// This is a low-accuracy heuristic (most small businesses don't have an
// obvious domain), but it doesn't evade anything: it just requests a
// handful of plausible URLs directly, the same as typing one into a
// browser, and keeps whichever one actually resolves and looks real.
const FETCH_TIMEOUT_MS = 5000;
const MAX_ATTEMPTS = 3;

const LEGAL_SUFFIXES = /\b(llc|inc|incorporated|corp|corporation|co|ltd|llp|pllc|pc)\b\.?/gi;
const STOPWORDS = new Set(["the", "and", "of", "a", "an"]);
const NAME_SEPARATORS = [" - ", " – ", " | ", " · "];

const PARKED_DOMAIN_MARKERS = [
  "domain is for sale",
  "buy this domain",
  "this domain may be for sale",
  "parked free",
  "hugedomains",
  "domain parking",
];

function splitPersonAndBrokerage(raw: string): { person: string; brokerage: string | null } {
  for (const sep of NAME_SEPARATORS) {
    const idx = raw.indexOf(sep);
    if (idx > 0) {
      return { person: raw.slice(0, idx).trim(), brokerage: raw.slice(idx + sep.length).trim() };
    }
  }
  return { person: raw, brokerage: null };
}

function normalizeWords(raw: string): string[] {
  let s = raw.toLowerCase().replace(/['".,]/g, "");
  s = s.replace(LEGAL_SUFFIXES, "");
  s = s.replace(/[^a-z0-9\s-]/g, " ");
  return s
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w && !STOPWORDS.has(w));
}

function buildSlugCandidates(name: string): string[] {
  const words = normalizeWords(name);
  if (words.length === 0) return [];
  const candidates = new Set<string>([words.join("")]);
  if (words.length > 2) candidates.add(words.slice(0, 2).join(""));
  if (words.length > 1) candidates.add(words[0]! + words[words.length - 1]!);
  return [...candidates].filter((c) => c.length >= 3 && c.length <= 40);
}

function pickSignificantWord(name: string): string | null {
  const words = normalizeWords(name).filter((w) => w.length >= 4);
  if (words.length === 0) return null;
  return words.reduce((longest, w) => (w.length > longest.length ? w : longest));
}

async function checkCandidate(url: string, significantWord: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PipelinesOutreachBot/1.0)" },
    });
    clearTimeout(timer);
    if (!res.ok) return false;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("html")) return false;

    const html = (await res.text()).toLowerCase();
    if (PARKED_DOMAIN_MARKERS.some((marker) => html.includes(marker))) return false;
    return html.includes(significantWord);
  } catch {
    return false;
  }
}

/**
 * Tries a handful of plausible domains for a business and returns the
 * first one that resolves, looks like a real (non-parked) site, and
 * mentions a significant word from the business's name. Returns null if
 * nothing plausible turns up — callers should treat that as "no website
 * found," same as if Yelp/ADRE had returned one that led nowhere.
 */
export async function guessWebsiteForBusiness(name: string, brokerage?: string | null): Promise<string | null> {
  const { person, brokerage: splitBrokerage } = splitPersonAndBrokerage(name);
  const brokerageName = (brokerage || splitBrokerage)?.trim() || null;

  const nameCandidates = brokerageName ? [brokerageName, person] : [name];

  const tried = new Set<string>();
  let attempts = 0;
  for (const candidateName of nameCandidates) {
    const significantWord = pickSignificantWord(candidateName);
    if (!significantWord) continue;

    for (const slug of buildSlugCandidates(candidateName)) {
      if (attempts >= MAX_ATTEMPTS) return null;
      const url = `https://www.${slug}.com`;
      if (tried.has(url)) continue;
      tried.add(url);
      attempts++;

      if (await checkCandidate(url, significantWord)) return url;
    }
  }
  return null;
}
