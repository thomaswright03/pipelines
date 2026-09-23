// Cloud-native replacement for lead-discovery.ts/vault-lead-discovery.ts's
// Selenium/Google-Maps scrape — Yelp's own Business Search API, a
// sanctioned REST endpoint (no anti-bot fight, no headless Chrome, works
// fine from a Vercel function). Needs a free Yelp Fusion API key:
// https://www.yelp.com/developers/v3/manage_app
//
// Trade-off worth knowing: Yelp's search response gives name/phone/address
// reliably, but not a business's own website (only Yelp's page for it) —
// so the free website-scrape step in email-finder.ts, which needs a
// website to fetch, will come up empty more often than the old Google Maps
// scrape did. Leads Yelp can't get an email for still get a phone number,
// so they're usable via the cold-call flow either way.
export type YelpCandidate = {
  name: string;
  phone: string | null;
  address: string | null;
  website: string | null;
};

type YelpBusiness = {
  name: string;
  phone: string | null;
  location: { display_address: string[] };
};

type YelpSearchResponse = {
  businesses?: YelpBusiness[];
  error?: { code: string; description: string };
};

const YELP_SEARCH_URL = "https://api.yelp.com/v3/businesses/search";
const PAGE_LIMIT = 50; // Yelp's max per request — matches our own per-run cap anyway.

export async function findBusinessesViaYelp(
  term: string,
  location: string,
): Promise<YelpCandidate[]> {
  const apiKey = process.env.YELP_API_KEY;
  if (!apiKey) {
    throw new Error("YELP_API_KEY isn't set — business discovery can't run until it is.");
  }

  const url = new URL(YELP_SEARCH_URL);
  url.searchParams.set("term", term || "local businesses");
  url.searchParams.set("location", location);
  url.searchParams.set("limit", String(PAGE_LIMIT));

  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  const body = (await res.json()) as YelpSearchResponse;

  if (!res.ok) {
    throw new Error(body.error?.description ?? `Yelp search failed (${res.status})`);
  }

  return (body.businesses ?? []).map((b) => ({
    name: b.name,
    phone: b.phone || null,
    address: b.location.display_address.join(", ") || null,
    website: null, // Yelp's search API doesn't expose the business's own site.
  }));
}
