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
  { website: "https://www.joespizza.com", html: "<title>Joe's Pizza | Phoenix</title>Serving Phoenix since 1990", facts: phx("Joe's Pizza", { phone: null, address: null }), belongs: true },
  { website: "https://www.joespizza.com", html: "Joe's Pizza — the best slice in Phoenix! (602) 555-9999", facts: phx("Joe's Pizza"), belongs: false },
  { website: "https://www.joespizza.com", html: "<title>Joe's Pizza</title>Locations: Phoenix, Tempe, Mesa. Find a location near you.", facts: phx("Joe's Pizza"), belongs: false },
  { website: "https://www.joespizza.com", html: "<title>Joe's Pizza Brooklyn</title>Best pizza in Brooklyn (718) 555-0100", facts: phx("Joe's Pizza"), belongs: false },
  { website: "https://www.pizzahouse.com", html: "<title>Pizza House</title>Phoenix", facts: phx("Pizza House", { phone: null, address: null }), belongs: false },
  { website: "https://www.x.com", html: "Order #16025550142999", facts: phx("X", { address: null, city: null }), belongs: false },
];

export const SITE_HELD_OUT: LabelledSite[] = [
  { website: "https://www.saguarodental.com", html: '<a href="tel:+16025550142">Call us</a>', facts: phx("Saguaro Dental"), belongs: true },
  { website: "https://www.saguarodental.com", html: "<title>Saguaro Dental – Family Dentistry in Phoenix, AZ</title>Phoenix's friendliest dentist", facts: phx("Saguaro Dental", { phone: null, address: null }), belongs: true },
  { website: "https://www.brightplumbing.com", html: "Bright Plumbing · 2210 E. Camelback Rd · Phoenix", facts: phx("Bright Plumbing"), belongs: true },
  { website: "https://www.brightplumbing.com", html: "<title>Bright Plumbing</title>Proudly serving Phoenix and the Valley. Franchise opportunities available!", facts: phx("Bright Plumbing", { phone: null, address: null }), belongs: false },
  { website: "https://www.brightplumbing.com", html: "<title>Bright Plumbing Denver</title>Denver's best plumbers (303) 555-0100", facts: phx("Bright Plumbing"), belongs: false },
  { website: "https://www.saguarodental.com", html: "Saguaro Dental in Phoenix", facts: phx("Saguaro Dental", { phone: null, address: null }), belongs: false },
  { website: "https://www.goldenbarber.com", html: "<title>Golden Barber Co.</title>Barbers in Tucson (520) 555-0101", facts: phx("Golden Barber"), belongs: false },
  { website: "https://www.goldenbarber.com", html: "<title>Barber Shop Phoenix</title>Phoenix walk-ins welcome", facts: phx("Golden Barber", { phone: null, address: null }), belongs: false },
  { website: "https://www.mesaauto.com", html: "<title>Mesa Auto Repair</title>Visit our store locator for Phoenix and 40 more cities", facts: phx("Mesa Auto Repair", { phone: null, address: null }), belongs: false },
  { website: "https://www.cactuscleaning.com", html: "Cactus Cleaning, 2210 Camelback Rd, Phoenix AZ", facts: phx("Cactus Cleaning", { address: "2210 Camelback Rd, Phoenix, AZ 85016" }), belongs: true },
];
