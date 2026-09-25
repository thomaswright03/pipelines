// A labelled set for guessed-website acceptance
// (src/lib/outreach/site-evidence.ts): discovery guesses www.<name>.com for
// a lead and may only use an address found there if the site is the
// lead's. Scored by tests/heuristics-eval.test.ts, precision first — a
// false accept spends the lead's one pitch on a stranger.
//
// Provenance: SYNTHETIC pages modelled on small-business sites, chains and
// franchises, and same-named businesses in other cities — not real sites.
//
// Splits: SITE_DEV was written alongside the rules; SITE_HELD_OUT was
// written separately, scored once as-is, and is never used when changing
// the rules. First run (2026-09-25): precision 100%, recall 100%.
// Round 6 (2026-09-25): held-out grown to 50 with fresh cases, scored as-is:
// precision 92.0%, recall 100% — it accepted a chain's "Find a store near
// you" page and "Phoenix Locksmith" titled with the city it is named after.
// Both were real gaps, fixed from new development cases, so those two
// held-out cases no longer measure anything new.

import type { LeadFacts } from "@/lib/outreach/site-evidence";

export type LabelledSite = { website: string; html: string; facts: LeadFacts; belongs: boolean };

const phx = (name: string, extra: Partial<LeadFacts> = {}): LeadFacts => ({
  name,
  phone: "(602) 555-0142",
  address: "2210 E Camelback Rd, Phoenix, AZ 85016",
  city: "Phoenix",
  ...extra,
});

export const SITE_DEV: LabelledSite[] = [
  { website: "https://www.joespizza.com", html: "<title>Joe's Pizza</title>Call (602) 555-0142", facts: phx("Joe's Pizza"), belongs: true },
  { website: "https://www.joespizza.com", html: "Visit us at 2210 East Camelback Road", facts: phx("Joe's Pizza"), belongs: true },
  {
    website: "https://www.joespizza.com",
    html: "<title>Joe's Pizza | Phoenix</title>Serving Phoenix since 1990",
    facts: phx("Joe's Pizza", { phone: null, address: null }),
    belongs: true,
  },
  {
    website: "https://www.joespizza.com",
    html: "Joe's Pizza — the best slice in Phoenix! (602) 555-9999",
    facts: phx("Joe's Pizza"),
    belongs: false,
  },
  {
    website: "https://www.joespizza.com",
    html: "<title>Joe's Pizza</title>Locations: Phoenix, Tempe, Mesa. Find a location near you.",
    facts: phx("Joe's Pizza"),
    belongs: false,
  },
  {
    website: "https://www.joespizza.com",
    html: "<title>Joe's Pizza Brooklyn</title>Best pizza in Brooklyn (718) 555-0100",
    facts: phx("Joe's Pizza"),
    belongs: false,
  },
  {
    website: "https://www.pizzahouse.com",
    html: "<title>Pizza House</title>Phoenix",
    facts: phx("Pizza House", { phone: null, address: null }),
    belongs: false,
  },
  { website: "https://www.x.com", html: "Order #16025550142999", facts: phx("X", { address: null, city: null }), belongs: false },
  // Added after the round-6 held-out batch found the same two gaps (a chain's
  // "find a store" page, and a name that is just the city plus a trade).
  {
    website: "https://www.bigboxtools.com",
    html: "<title>Big Box Tools</title>Stores near you: Phoenix, Glendale and 300 more",
    facts: phx("Big Box Tools", { phone: null, address: null }),
    belongs: false,
  },
  {
    website: "https://www.phoenixglass.com",
    html: "<title>Phoenix Glass</title>Windshields for all of Phoenix",
    facts: phx("Phoenix Glass", { phone: null, address: null }),
    belongs: false,
  },
];

export const SITE_HELD_OUT: LabelledSite[] = [
  { website: "https://www.saguarodental.com", html: '<a href="tel:+16025550142">Call us</a>', facts: phx("Saguaro Dental"), belongs: true },
  {
    website: "https://www.saguarodental.com",
    html: "<title>Saguaro Dental – Family Dentistry in Phoenix, AZ</title>Phoenix's friendliest dentist",
    facts: phx("Saguaro Dental", { phone: null, address: null }),
    belongs: true,
  },
  {
    website: "https://www.brightplumbing.com",
    html: "Bright Plumbing · 2210 E. Camelback Rd · Phoenix",
    facts: phx("Bright Plumbing"),
    belongs: true,
  },
  {
    website: "https://www.brightplumbing.com",
    html: "<title>Bright Plumbing</title>Proudly serving Phoenix and the Valley. Franchise opportunities available!",
    facts: phx("Bright Plumbing", { phone: null, address: null }),
    belongs: false,
  },
  {
    website: "https://www.brightplumbing.com",
    html: "<title>Bright Plumbing Denver</title>Denver's best plumbers (303) 555-0100",
    facts: phx("Bright Plumbing"),
    belongs: false,
  },
  {
    website: "https://www.saguarodental.com",
    html: "Saguaro Dental in Phoenix",
    facts: phx("Saguaro Dental", { phone: null, address: null }),
    belongs: false,
  },
  {
    website: "https://www.goldenbarber.com",
    html: "<title>Golden Barber Co.</title>Barbers in Tucson (520) 555-0101",
    facts: phx("Golden Barber"),
    belongs: false,
  },
  {
    website: "https://www.goldenbarber.com",
    html: "<title>Barber Shop Phoenix</title>Phoenix walk-ins welcome",
    facts: phx("Golden Barber", { phone: null, address: null }),
    belongs: false,
  },
  {
    website: "https://www.mesaauto.com",
    html: "<title>Mesa Auto Repair</title>Visit our store locator for Phoenix and 40 more cities",
    facts: phx("Mesa Auto Repair", { phone: null, address: null }),
    belongs: false,
  },
  {
    website: "https://www.cactuscleaning.com",
    html: "Cactus Cleaning, 2210 Camelback Rd, Phoenix AZ",
    facts: phx("Cactus Cleaning", { address: "2210 Camelback Rd, Phoenix, AZ 85016" }),
    belongs: true,
  },
  // Fresh batch, 2026-09-25 (round 6), written before scoring and scored as-is.
  {
    website: "https://www.desertbloomflorist.com",
    html: "<title>Desert Bloom Florist</title>Call (602) 555-0142 for same-day delivery",
    facts: phx("Desert Bloom Florist"),
    belongs: true,
  },
  { website: "https://www.desertbloomflorist.com", html: "Phone: 602.555.0142", facts: phx("Desert Bloom Florist"), belongs: true },
  { website: "https://www.desertbloomflorist.com", html: "Phone: 602-555-0142", facts: phx("Desert Bloom Florist"), belongs: true },
  {
    website: "https://www.desertbloomflorist.com",
    html: "Find us: 2210 E Camelback Rd, Phoenix, AZ 85016",
    facts: phx("Desert Bloom Florist"),
    belongs: true,
  },
  {
    website: "https://www.redrockroofing.com",
    html: "<title>Red Rock Roofing | Roofers in Phoenix, AZ</title>Licensed roofers",
    facts: phx("Red Rock Roofing", { phone: null, address: null }),
    belongs: true,
  },
  {
    website: "https://www.redrockroofing.com",
    html: '<a href="tel:6025550142">(602) 555-0142</a>',
    facts: phx("Red Rock Roofing"),
    belongs: true,
  },
  {
    website: "https://www.sunnysidecafe.com",
    html: "Sunnyside Cafe · 2210 East Camelback Road · Phoenix",
    facts: phx("Sunnyside Cafe"),
    belongs: true,
  },
  {
    website: "https://www.valleyvet.com",
    html: "<title>Valley Vet Clinic</title>Call us today: +1 (602) 555-0142",
    facts: phx("Valley Vet Clinic"),
    belongs: true,
  },
  {
    website: "https://www.valleyvet.com",
    html: "<title>Valley Vet Supply</title>Farm and ranch supplies shipped nationwide. 1-800-555-0199",
    facts: phx("Valley Vet Clinic"),
    belongs: false,
  },
  {
    website: "https://www.sunnysidecafe.com",
    html: "<title>Sunnyside Cafe</title>Breakfast in Portland, OR (503) 555-0110",
    facts: phx("Sunnyside Cafe"),
    belongs: false,
  },
  {
    website: "https://www.sunnysidecafe.com",
    html: "<title>Sunnyside Cafe</title>Breakfast and lunch",
    facts: phx("Sunnyside Cafe", { phone: null, address: null }),
    belongs: false,
  },
  {
    website: "https://www.redrockroofing.com",
    html: "<title>Red Rock Roofing</title>Serving Sedona and Flagstaff (928) 555-0120",
    facts: phx("Red Rock Roofing"),
    belongs: false,
  },
  {
    website: "https://www.redrockroofing.com",
    html: "This domain is for sale! Buy redrockroofing.com today.",
    facts: phx("Red Rock Roofing"),
    belongs: false,
  },
  {
    website: "https://www.desertbloomflorist.com",
    html: "<title>Desert Bloom Florist</title>Las Vegas' favorite florist. 3200 S Las Vegas Blvd",
    facts: phx("Desert Bloom Florist"),
    belongs: false,
  },
  {
    website: "https://www.acehardware.com",
    html: "<title>Ace Hardware</title>Find a store near you. Phoenix, Tempe, Chandler, Mesa and 5,000 more",
    facts: phx("Ace Hardware", { phone: null, address: null }),
    belongs: false,
  },
  {
    website: "https://www.elitefitness.com",
    html: "<title>Elite Fitness</title>Gyms in Dallas, Houston, Austin. Call 214-555-0133",
    facts: phx("Elite Fitness"),
    belongs: false,
  },
  {
    website: "https://www.elitefitness.com",
    html: "Elite Fitness — personal training",
    facts: phx("Elite Fitness", { phone: null, address: null }),
    belongs: false,
  },
  {
    website: "https://www.elitefitness.com",
    html: "Invoice 602555014200 paid",
    facts: phx("Elite Fitness", { address: null, city: null }),
    belongs: false,
  },
  {
    website: "https://www.hometowninsurance.com",
    html: "<title>Hometown Insurance</title>Agents in all 50 states. Get a quote.",
    facts: phx("Hometown Insurance", { phone: null, address: null }),
    belongs: false,
  },
  {
    website: "https://www.hometowninsurance.com",
    html: "<title>Hometown Insurance Agency — Phoenix, AZ</title>Local agents you know",
    facts: phx("Hometown Insurance", { phone: null, address: null }),
    belongs: true,
  },
  {
    website: "https://www.bluesky-hvac.com",
    html: "Blue Sky HVAC (602) 555-0142 — 24/7 emergency service",
    facts: phx("Blue Sky HVAC"),
    belongs: true,
  },
  {
    website: "https://www.bluesky-hvac.com",
    html: "Blue Sky HVAC (480) 555-0177 — Mesa and Gilbert",
    facts: phx("Blue Sky HVAC"),
    belongs: false,
  },
  {
    website: "https://www.petalandstem.com",
    html: "Petal & Stem, Suite 4, 2210 E Camelback Rd, Phoenix AZ 85016",
    facts: phx("Petal & Stem"),
    belongs: true,
  },
  {
    website: "https://www.petalandstem.com",
    html: "<title>Petal & Stem</title>Wedding florals in Tucson",
    facts: phx("Petal & Stem", { phone: null, address: null }),
    belongs: false,
  },
  {
    website: "https://www.lotuspho.com",
    html: "<title>Lotus Pho</title>Now open in Phoenix! (602) 555-0142",
    facts: phx("Lotus Pho"),
    belongs: true,
  },
  {
    website: "https://www.lotuspho.com",
    html: "<title>Lotus Pho</title>San Jose's best pho (408) 555-0150",
    facts: phx("Lotus Pho"),
    belongs: false,
  },
  {
    website: "https://www.ironhorsegarage.com",
    html: "Iron Horse Garage — call 602 555 0142",
    facts: phx("Iron Horse Garage"),
    belongs: true,
  },
  {
    website: "https://www.ironhorsegarage.com",
    html: "Iron Horse Garage — Harley parts, ships worldwide",
    facts: phx("Iron Horse Garage", { phone: null, address: null }),
    belongs: false,
  },
  {
    website: "https://www.phoenixlocksmith.com",
    html: "<title>Phoenix Locksmith</title>Serving Phoenix, AZ",
    facts: phx("Phoenix Locksmith", { phone: null, address: null }),
    belongs: false,
  },
  {
    website: "https://www.phoenixlocksmith.com",
    html: "<title>Phoenix Locksmith</title>Call (602) 555-0142",
    facts: phx("Phoenix Locksmith"),
    belongs: true,
  },
  {
    website: "https://www.sonorantax.com",
    html: "Sonoran Tax Services — 2210 E. Camelback Road, Phoenix",
    facts: phx("Sonoran Tax Services"),
    belongs: true,
  },
  {
    website: "https://www.sonorantax.com",
    html: "Sonoran Tax Services — 4400 N Scottsdale Rd, Scottsdale",
    facts: phx("Sonoran Tax Services"),
    belongs: false,
  },
  {
    website: "https://www.happypaws.com",
    html: "<title>Happy Paws</title>Pet grooming franchise — own your own Happy Paws!",
    facts: phx("Happy Paws", { phone: null, address: null }),
    belongs: false,
  },
  {
    website: "https://www.happypaws.com",
    html: "<title>Happy Paws Grooming Phoenix</title>(602) 555-0142",
    facts: phx("Happy Paws"),
    belongs: true,
  },
  {
    website: "https://www.grandcanyonmovers.com",
    html: "Grand Canyon Movers: moving across Arizona. Offices in Phoenix, Tucson, Flagstaff.",
    facts: phx("Grand Canyon Movers", { phone: null, address: null }),
    belongs: false,
  },
  {
    website: "https://www.grandcanyonmovers.com",
    html: "Grand Canyon Movers <a href='tel:+1-602-555-0142'>Call</a>",
    facts: phx("Grand Canyon Movers"),
    belongs: true,
  },
  {
    website: "https://www.oasisnails.com",
    html: "<title>Oasis Nails</title>Welcome",
    facts: phx("Oasis Nails", { phone: null, address: null }),
    belongs: false,
  },
  {
    website: "https://www.oasisnails.com",
    html: "<title>Oasis Nails & Spa</title>Phone (602) 555-0142 · Phoenix",
    facts: phx("Oasis Nails"),
    belongs: true,
  },
  {
    website: "https://www.copperstatecpa.com",
    html: "Copper State CPA, 2210 E Camelback Rd Ste 300, Phoenix, AZ 85016 · (602) 555-0142",
    facts: phx("Copper State CPA"),
    belongs: true,
  },
  {
    website: "https://www.copperstatecpa.com",
    html: "Parked free, courtesy of GoDaddy.com",
    facts: phx("Copper State CPA"),
    belongs: false,
  },
];
