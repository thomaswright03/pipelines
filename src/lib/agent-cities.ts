// Cities within the three counties dataleadsell.com currently sells access
// to (Maricopa County AZ, Salt Lake County UT, Utah County UT) — the scrape
// pool for finding real estate agents to pitch a subscription to. Add a
// county's cities here when dataleadsell.com adds that county as a plan.
export type AgentCityTarget = { city: string; county: string; state: string };

export const AGENT_CITIES: AgentCityTarget[] = [
  // Maricopa County, AZ
  { city: "Phoenix", county: "Maricopa", state: "AZ" },
  { city: "Mesa", county: "Maricopa", state: "AZ" },
  { city: "Chandler", county: "Maricopa", state: "AZ" },
  { city: "Scottsdale", county: "Maricopa", state: "AZ" },
  { city: "Glendale", county: "Maricopa", state: "AZ" },
  { city: "Gilbert", county: "Maricopa", state: "AZ" },
  { city: "Tempe", county: "Maricopa", state: "AZ" },
  { city: "Peoria", county: "Maricopa", state: "AZ" },
  { city: "Surprise", county: "Maricopa", state: "AZ" },
  { city: "Avondale", county: "Maricopa", state: "AZ" },
  { city: "Goodyear", county: "Maricopa", state: "AZ" },
  { city: "Buckeye", county: "Maricopa", state: "AZ" },
  { city: "Fountain Hills", county: "Maricopa", state: "AZ" },
  { city: "Paradise Valley", county: "Maricopa", state: "AZ" },
  { city: "Cave Creek", county: "Maricopa", state: "AZ" },
  { city: "El Mirage", county: "Maricopa", state: "AZ" },
  { city: "Tolleson", county: "Maricopa", state: "AZ" },
  { city: "Litchfield Park", county: "Maricopa", state: "AZ" },

  // Salt Lake County, UT
  { city: "Salt Lake City", county: "Salt Lake", state: "UT" },
  { city: "West Valley City", county: "Salt Lake", state: "UT" },
  { city: "West Jordan", county: "Salt Lake", state: "UT" },
  { city: "Sandy", county: "Salt Lake", state: "UT" },
  { city: "South Jordan", county: "Salt Lake", state: "UT" },
  { city: "Millcreek", county: "Salt Lake", state: "UT" },
  { city: "Murray", county: "Salt Lake", state: "UT" },
  { city: "Taylorsville", county: "Salt Lake", state: "UT" },
  { city: "Riverton", county: "Salt Lake", state: "UT" },
  { city: "Herriman", county: "Salt Lake", state: "UT" },
  { city: "Midvale", county: "Salt Lake", state: "UT" },
  { city: "Cottonwood Heights", county: "Salt Lake", state: "UT" },
  { city: "Holladay", county: "Salt Lake", state: "UT" },
  { city: "South Salt Lake", county: "Salt Lake", state: "UT" },
  { city: "Bluffdale", county: "Salt Lake", state: "UT" },

  // Utah County, UT
  { city: "Provo", county: "Utah", state: "UT" },
  { city: "Orem", county: "Utah", state: "UT" },
  { city: "Lehi", county: "Utah", state: "UT" },
  { city: "American Fork", county: "Utah", state: "UT" },
  { city: "Pleasant Grove", county: "Utah", state: "UT" },
  { city: "Spanish Fork", county: "Utah", state: "UT" },
  { city: "Springville", county: "Utah", state: "UT" },
  { city: "Payson", county: "Utah", state: "UT" },
  { city: "Saratoga Springs", county: "Utah", state: "UT" },
  { city: "Eagle Mountain", county: "Utah", state: "UT" },
  { city: "Highland", county: "Utah", state: "UT" },
  { city: "Alpine", county: "Utah", state: "UT" },
  { city: "Lindon", county: "Utah", state: "UT" },
  { city: "Mapleton", county: "Utah", state: "UT" },
  { city: "Santaquin", county: "Utah", state: "UT" },
];

/** The counties dataleadsell.com sells, with their state — the only valid choices anywhere a county is picked. */
export const SOLD_COUNTIES: { county: string; state: string }[] = [
  ...new Map(AGENT_CITIES.map((c) => [c.county, { county: c.county, state: c.state }])).values(),
];

export function stateForCounty(county: string): string | null {
  return SOLD_COUNTIES.find((c) => c.county === county)?.state ?? null;
}

export function citiesInCounty(county: string): string[] {
  return AGENT_CITIES.filter((c) => c.county === county).map((c) => c.city);
}
