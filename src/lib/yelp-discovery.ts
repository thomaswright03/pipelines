// Business discovery through Yelp's Business Search API — a sanctioned
// REST endpoint that works from a Vercel function (no headless browser).
// Needs a free Yelp Fusion API key: https://www.yelp.com/developers/v3/manage_app
//
// Trade-off worth knowing: Yelp gives name/phone/address reliably but not a
// business's own website, so the email lookup has to guess the site from
// the name (see website-finder.ts). Leads without an email still have a
// phone number for the cold-call deck.
import { z } from "zod";
import { logError } from "@/lib/log";
import { recordServiceCheck } from "@/lib/outreach/settings";

type YelpCandidate = {
  name: string;
  phone: string | null;
  address: string | null;
  website: string | null;
  /** Yelp's category names for the business ("Garbage Collection", "Dumpster Rental"). */
  categories: string[];
};

// The fields this module reads from a successful search, validated so a
// change on Yelp's side is reported as such instead of surfacing as an
// unexplained crash or a silent "found nothing". Other fields are ignored.
const yelpSearchSchema = z.object({
  businesses: z.array(
    z.object({
      name: z.string().nullish(),
      phone: z.string().nullish(),
      location: z.object({ display_address: z.array(z.string()).nullish() }).nullish(),
      categories: z.array(z.object({ title: z.string().nullish() })).nullish(),
    }),
  ),
});
type YelpErrorBody = { error?: { code?: string; description?: string } };

/** Shown (and kept in Settings → Connections and the run log) when Yelp's answer no longer has the expected shape. */
export const YELP_SHAPE_CHANGED =
  "Yelp's response changed, so the search results couldn't be read — nothing was added. Tell your developer.";

const YELP_SEARCH_URL = "https://api.yelp.com/v3/businesses/search";
const PAGE_LIMIT = 50; // Yelp's max per request — matches our own per-run cap anyway.
const FETCH_TIMEOUT_MS = 10_000;

/**
 * A Yelp failure, with a message written for the operator. `message` is for
 * a search someone just pressed a button for; `unattended` is for the 8:33
 * AM daily run, where there's nothing to "try again" — it says what happens
 * next on its own and when to tell the developer.
 */
export class YelpError extends Error {
  readonly unattended: string;
  constructor(message: string, unattended: string = message) {
    super(message);
    this.name = "YelpError";
    this.unattended = unattended;
  }
}

const TRIES_AGAIN = "The next daily run tries again automatically; if this happens two days in a row, tell your developer.";

/**
 * Searches Yelp. Every answer or failure (other than a location Yelp didn't
 * recognise, which is the operator's input, not the service) is remembered
 * for Settings → Connections. `limit` defaults to Yelp's maximum of 50.
 */
export async function findBusinessesViaYelp(term: string, location: string, options: { limit?: number } = {}): Promise<YelpCandidate[]> {
  const apiKey = process.env.YELP_API_KEY;
  if (!apiKey) {
    throw new YelpError(
      "Yelp isn't set up yet, so the search can't run — ask your developer to add the Yelp access key.",
      "Yelp isn't set up yet, so no new leads were found — ask your developer to add the Yelp access key. Until then the daily run only emails leads already waiting.",
    );
  }

  const url = new URL(YELP_SEARCH_URL);
  url.searchParams.set("term", term || "local businesses");
  url.searchParams.set("location", location);
  url.searchParams.set("limit", String(Math.min(Math.max(1, options.limit ?? PAGE_LIMIT), PAGE_LIMIT)));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  let raw: string;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` }, signal: controller.signal });
    raw = await res.text();
  } catch (err) {
    logError("yelp.search", err, { location });
    const message = "Couldn't reach Yelp — nothing was used up. Check the connection and try again.";
    await recordServiceCheck("yelp", message);
    throw new YelpError(message, `Couldn't reach Yelp, so no new leads were found this time (nothing was used up). ${TRIES_AGAIN}`);
  } finally {
    clearTimeout(timer);
  }

  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    body = null;
  }

  if (!res.ok || body === null || typeof body !== "object") {
    logError("yelp.search", new Error(`HTTP ${res.status}: ${raw.slice(0, 300)}`), { location });
    const code = (body as YelpErrorBody | null)?.error?.code;
    const { message, unattended } = describeYelpFailure(res.status, code);
    // A location Yelp didn't recognise still proves the key and service work.
    await recordServiceCheck("yelp", isLocationProblem(code) ? null : message);
    throw new YelpError(message, unattended);
  }

  const parsed = yelpSearchSchema.safeParse(body);
  if (!parsed.success) {
    const where = parsed.error.issues.map((i) => `${i.path.join(".") || "(body)"}: ${i.message}`).slice(0, 3);
    logError("yelp.search", new Error(`Unexpected response shape — ${where.join("; ")}`), { location });
    await recordServiceCheck("yelp", YELP_SHAPE_CHANGED);
    throw new YelpError(YELP_SHAPE_CHANGED);
  }

  await recordServiceCheck("yelp", null);

  return parsed.data.businesses
    .filter((b) => b.name?.trim())
    .map((b) => ({
      name: b.name!.trim(),
      phone: b.phone || null,
      address: b.location?.display_address?.join(", ") || null,
      website: null, // Yelp's search API doesn't expose the business's own site.
      categories: (b.categories ?? []).map((c) => c.title?.trim() ?? "").filter(Boolean),
    }));
}

function isLocationProblem(code: string | undefined): boolean {
  return code === "LOCATION_NOT_FOUND" || code === "VALIDATION_ERROR";
}

function describeYelpFailure(status: number, code: string | undefined): { message: string; unattended: string } {
  if (isLocationProblem(code)) {
    return {
      message: "Yelp didn't recognise that location — check the city and state.",
      unattended:
        "Yelp didn't recognise the city this run picked, so no new leads were found. If the same city keeps failing, tell your developer.",
    };
  }
  if (status === 401 || status === 403 || code === "TOKEN_INVALID") {
    return {
      message: "Yelp rejected our access key — ask your developer to check it.",
      unattended:
        "Yelp rejected our access key, so no new leads were found — ask your developer to check it. Daily runs can't find leads until it's fixed.",
    };
  }
  if (status === 429 || code === "ACCESS_LIMIT_REACHED" || code === "TOO_MANY_REQUESTS_PER_SECOND") {
    return {
      message: "Yelp's daily search limit is used up — try again tomorrow.",
      unattended: "Yelp's daily search limit was used up, so no new leads were found. The next daily run tries again tomorrow.",
    };
  }
  return {
    message: "Yelp isn't responding right now — nothing was used up, try again later.",
    unattended: `Yelp wasn't responding, so no new leads were found this time (nothing was used up). ${TRIES_AGAIN}`,
  };
}
