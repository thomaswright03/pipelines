// Who Room Designer 3D never pitches (the intake form's "Who to leave out"):
// - Eddys Remodeling, Thomas's client;
// - national franchises and big-box installers (Bath Fitter, Re-Bath, Five
//   Star Bath Solutions, Kitchen Tune-Up, home-improvement store
//   installation services);
// - plumbing-only and supply-house listings, and cabinet or tile showrooms
//   that don't do installs: a Yelp result whose categories are all of that
//   kind, or whose name says it is a supply house or showroom.
// Remodelers another pipeline already emailed are kept out by the send
// ledger (one pitch per address across pipelines; see send.ts). Whether a
// remodeler already has a Room Designer 3D account can't be checked from
// here: that app keeps its own accounts.

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const hasWords = (haystack: string, needle: string) => ` ${haystack} `.includes(` ${needle} `);

// "Eddys Remodeling" / "Eddy's Remodeling" both normalize to "eddys remodeling".
const CLIENTS = ["eddys remodeling"];
// The same client run together in an email domain ("info@eddysremodeling.com").
const CLIENT_DOMAIN_KEYS = ["eddysremodeling"];

// Matched as whole words in the normalized name.
const FRANCHISES = [
  "bath fitter",
  "re bath",
  "rebath",
  "five star bath solutions",
  "kitchen tune up",
  "bath planet",
  "luxury bath",
  "west shore home",
  "jacuzzi bath remodel",
  "home depot",
  "lowes",
  "menards",
  "sears home services",
];

// A name that says the business sells, not installs.
const SUPPLY_OR_SHOWROOM = [/\bsupply\b/, /\bsupplies\b/, /\bshowroom\b/, /\bwholesale\b/, /\bdistributors?\b/];

// Yelp categories that on their own mean a plumber, a supply house or a
// showroom. A listing with any other category too (Contractors, Kitchen &
// Bath remodeling, Tiling, Handyman…) is kept.
const NOT_A_REMODELER_CATEGORIES = new Set(
  [
    "Plumbing",
    "Water Heater Installation/Repair",
    "Hydro-jetting",
    "Building Supplies",
    "Hardware Stores",
    "Home Decor",
    "Kitchen & Bath",
    "Cabinetry",
    "Furniture Stores",
    "Appliances",
    "Lighting Fixtures & Equipment",
    "Wholesale Stores",
    "Home & Garden",
    "Flooring",
    "Tiles",
  ].map(normalize),
);

/** Why a Yelp result must never be pitched, or null when it may be. */
export function remodelerExclusion(candidate: { name: string; categories?: readonly string[] }): string | null {
  const name = normalize(candidate.name);
  if (CLIENTS.some((client) => hasWords(name, client))) return "Thomas's client";
  if (FRANCHISES.some((franchise) => hasWords(name, franchise))) return "a national franchise or big-box installer";
  if (SUPPLY_OR_SHOWROOM.some((pattern) => pattern.test(name))) return "a supply house or showroom";
  const categories = (candidate.categories ?? []).map(normalize).filter(Boolean);
  if (categories.length > 0 && categories.every((c) => NOT_A_REMODELER_CATEGORIES.has(c))) {
    return "a plumber, supply house or showroom, not a remodeler";
  }
  return null;
}

/**
 * Why a saved remodeler must never be emailed, or null when it may be — the
 * send gate's last check (send.ts), so one added or edited by hand is held
 * to the same name rules as a Yelp result. Beyond the name it also looks at
 * the company and the email's domain. (Categories are only screened at
 * search time: a remodeler added by hand was chosen by a person.)
 */
export function remodelerPitchExclusion(lead: { name: string; company: string | null; email: string | null }): string | null {
  for (const name of [lead.name, lead.company]) {
    if (!name) continue;
    const reason = remodelerExclusion({ name });
    if (reason) return reason;
  }
  const domain =
    lead.email
      ?.split("@")[1]
      ?.toLowerCase()
      .replace(/[^a-z0-9]/g, "") ?? "";
  if (CLIENT_DOMAIN_KEYS.some((key) => domain.includes(key))) return "Thomas's client";
  return null;
}
