// Arizona Department of Real Estate's public license roster — a real,
// verified alternative to Yelp for Maricopa County specifically. Unlike
// Yelp, this gives a genuine mailing address (useful as a physical-mail
// fallback channel later, even when no email turns up) and a real license
// status, at the cost of being Arizona-only: Utah's equivalent public data
// (checked directly) has no address/county field at all, so Salt Lake and
// Utah counties still go through yelp-discovery.ts.
//
// Source: https://services.azre.gov/PdbWeb/List/DownloadList/1 — a ~50MB
// CSV of every individual license ADRE has ever issued (all categories,
// all statuses, active and long-expired). We filter down to Maricopa
// County, Active, "Real Estate" category (excludes Cemetery/Campground
// licenses ADRE also regulates under the same system) — a still-large
// pool (~44k as of writing) of real, currently-licensed agents/brokers.
import { parse } from "csv-parse/sync";

const ADRE_LIST_URL = "https://services.azre.gov/PdbWeb/List/DownloadList/1";
const FETCH_TIMEOUT_MS = 45 * 1000;

export type AzLicensee = {
  name: string;
  brokerage: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  licenseType: string; // Broker | Salesperson
};

type AdreRow = {
  LastName: string;
  FirstName: string;
  MiddleName: string;
  LicCategory: string;
  LicType: string;
  LicStatus: string;
  EmployerDBAName: string;
  EmployerLegalName: string;
  EmployerPhone: string;
  MailingAddress1: string;
  MailingAddress2: string;
  MailingCity: string;
  MailingState: string;
  MailingZip: string;
  MailingCounty: string;
};

function formatName(row: AdreRow): string {
  const parts = [row.FirstName, row.MiddleName, row.LastName].map((p) => p.trim()).filter(Boolean);
  return parts.join(" ");
}

function formatAddress(row: AdreRow): string | null {
  const line1 = row.MailingAddress1.trim();
  const line2 = row.MailingAddress2.trim();
  const cityStateZip = [row.MailingCity.trim(), row.MailingState.trim()].filter(Boolean).join(", ");
  const full = [line1, line2, [cityStateZip, row.MailingZip.trim()].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  return full || null;
}

/**
 * Downloads and parses ADRE's full license roster, returning only Active,
 * "Real Estate" category licensees (Broker or Salesperson) in the given
 * county. This re-downloads the full ~50MB file every call — there's no
 * partial/filtered download offered — so callers should call this at most
 * once per pipeline run, not per-lead.
 */
export async function findLicenseesByCounty(county: string): Promise<AzLicensee[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let csvText: string;
  try {
    const res = await fetch(ADRE_LIST_URL, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`ADRE download failed (${res.status})`);
    }
    csvText = await res.text();
  } finally {
    clearTimeout(timer);
  }

  const rows = parse(csvText, { columns: true, skip_empty_lines: true, relax_column_count: true }) as AdreRow[];

  const licensees: AzLicensee[] = [];
  for (const row of rows) {
    if (row.MailingCounty?.trim() !== county) continue;
    if (row.LicStatus?.trim() !== "Active") continue;
    if (row.LicCategory?.trim() !== "Real Estate") continue;
    const licenseType = row.LicType?.trim();
    if (licenseType !== "Broker" && licenseType !== "Salesperson") continue;

    licensees.push({
      name: formatName(row),
      brokerage: (row.EmployerDBAName || row.EmployerLegalName || "").trim() || null,
      phone: row.EmployerPhone?.trim() || null,
      address: formatAddress(row),
      city: row.MailingCity?.trim() || null,
      licenseType,
    });
  }

  return licensees;
}
