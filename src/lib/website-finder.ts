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
import { classifyFetchError, classifyStatus, type FetchFailure } from "@/lib/fetch-failure";

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

/** "Jane Doe - Keller Williams" → person "Jane Doe", brokerage "Keller Williams". */
export function splitPersonAndBrokerage(raw: string): { person: string; brokerage: string | null } {
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

/** Whether `url` is a real site about this business, isn't, or couldn't be checked right now. */
async function checkCandidate(url: string, significantWord: string, outer?: AbortSignal): Promise<"match" | FetchFailure> {
  if (outer?.aborted) return "unreachable";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: outer ? AbortSignal.any([controller.signal, outer]) : controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PipelinesOutreachBot/1.0)" },
    });
    if (!res.ok) return classifyStatus(res.status);
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("html")) return "missing";

    const html = (await res.text()).toLowerCase();
    if (PARKED_DOMAIN_MARKERS.some((marker) => html.includes(marker))) return "missing";
    return html.includes(significantWord) ? "match" : "missing";
  } catch (err) {
    return classifyFetchError(err);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A guessed site, and whether it was guessed from the brokerage's name
 * (so it's the office's site, not the person's) or from the lead's own
 * name. Callers use `basedOn` to avoid pitching an individual agent through
 * their brokerage's shared inbox.
 */
type WebsiteGuess = { url: string; basedOn: "brokerage" | "name" };

/**
 * The outcome of guessing: the site found, or none — and when none, whether
 * that is a real answer (`inconclusive: false`: every candidate domain
 * doesn't exist or isn't this business) or some candidate couldn't be
 * checked (timeout, connection error, 5xx), so the guess should be retried
 * later rather than taken as "no website".
 */
type WebsiteGuessResult = { guess: WebsiteGuess; inconclusive: false } | { guess: null; inconclusive: boolean };

/**
 * Tries a handful of plausible domains for a business and returns the
 * first one that resolves, looks like a real (non-parked) site, and
 * mentions a significant word from the business's name.
 */
export async function guessWebsiteForBusiness(
  name: string,
  options: { brokerage?: string | null; splitPersonName?: boolean; signal?: AbortSignal } = {},
): Promise<WebsiteGuessResult> {
  // Only agent listings follow the "Person - Brokerage" convention; a
  // business called "Joe's Pizza - Downtown" isn't a person at "Downtown".
  const { person, brokerage: splitBrokerage } = options.splitPersonName ? splitPersonAndBrokerage(name) : { person: name, brokerage: null };
  const brokerageName = (options.brokerage || splitBrokerage)?.trim() || null;

  const nameCandidates: { name: string; basedOn: WebsiteGuess["basedOn"] }[] = brokerageName
    ? [
        { name: brokerageName, basedOn: "brokerage" },
        { name: person, basedOn: "name" },
      ]
    : [{ name, basedOn: "name" }];

  const tried = new Set<string>();
  let attempts = 0;
  let inconclusive = false;
  for (const candidate of nameCandidates) {
    const significantWord = pickSignificantWord(candidate.name);
    if (!significantWord) continue;

    for (const slug of buildSlugCandidates(candidate.name)) {
      if (attempts >= MAX_ATTEMPTS) return { guess: null, inconclusive };
      const url = `https://www.${slug}.com`;
      if (tried.has(url)) continue;
      tried.add(url);
      attempts++;

      const verdict = await checkCandidate(url, significantWord, options.signal);
      if (verdict === "match") return { guess: { url, basedOn: candidate.basedOn }, inconclusive: false };
      if (verdict === "unreachable") inconclusive = true;
    }
  }
  return { guess: null, inconclusive };
}
