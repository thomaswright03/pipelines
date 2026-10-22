// Arizona Department of Real Estate's public license roster — a real,
// verified source for Maricopa County specifically. Unlike the business
// list it gives a genuine mailing address and license status, at the cost
// of being Arizona-only: Utah's equivalent public data has no
// address/county field, so Salt Lake and Utah counties use the business list.
//
// Source: https://services.azre.gov/PdbWeb/List/DownloadList/1 — a ~50 MB
// CSV of every individual license ADRE has issued (all categories and
// statuses). We keep Active, "Real Estate" category Brokers and
// Salespersons in the county asked for (~44k for Maricopa as of writing).
import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";

const ADRE_LIST_URL = "https://services.azre.gov/PdbWeb/List/DownloadList/1";
// Loading the roster has its own call (see adre-import.ts); leave room in
// the 60 s function limit for parsing and saving after the download.
const FETCH_TIMEOUT_MS = 35 * 1000;

type AzLicensee = {
  key: string; // ADRE license number when present, else a stable hash
  name: string;
  brokerage: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  licenseType: string; // Broker | Salesperson
};

type AdreRow = Record<string, string | undefined>;

const LICENSE_NUMBER_COLUMNS = ["LicenseNumber", "LicenseNo", "LicNumber", "LicNo", "LicenseNum", "License"];

function col(row: AdreRow, name: string): string {
  return (row[name] ?? "").trim();
}

function formatName(row: AdreRow): string {
  return [col(row, "FirstName"), col(row, "MiddleName"), col(row, "LastName")].filter(Boolean).join(" ");
}

function formatAddress(row: AdreRow): string | null {
  const cityState = [col(row, "MailingCity"), col(row, "MailingState")].filter(Boolean).join(", ");
  const full = [col(row, "MailingAddress1"), col(row, "MailingAddress2"), [cityState, col(row, "MailingZip")].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  return full || null;
}

function licenseeKey(row: AdreRow, name: string, licenseType: string, address: string | null): string {
  for (const column of LICENSE_NUMBER_COLUMNS) {
    const value = col(row, column);
    if (value) return `adre:${value}`;
  }
  return `adre-hash:${createHash("sha1")
    .update(`${name}|${licenseType}|${address ?? ""}`)
    .digest("hex")}`;
}

/** Columns the import can't work without: the filters and the name. */
const ADRE_REQUIRED_COLUMNS = ["MailingCounty", "LicStatus", "LicCategory", "LicType", "FirstName", "LastName"] as const;

/**
 * The roster file isn't in the shape the import reads (ADRE renamed or
 * dropped a column). `columns` is the header actually received, for the log.
 */
export class AdreFormatError extends Error {
  constructor(
    readonly missing: string[],
    readonly columns: string[],
  ) {
    super(`ADRE's roster is missing column(s) ${missing.join(", ")}`);
    this.name = "AdreFormatError";
  }
}

/** The roster read fine but lists nobody for the county — suspicious, not a success. */
export class AdreEmptyRosterError extends Error {
  constructor(
    readonly county: string,
    readonly rows: number,
  ) {
    super(`ADRE's roster (${rows} rows) had no active ${county} County real-estate licensees`);
    this.name = "AdreEmptyRosterError";
  }
}

/**
 * Parses ADRE's roster CSV into the Active, "Real Estate" category Brokers
 * and Salespersons whose mailing county is `county`, in file order. Throws
 * AdreFormatError if a required column is missing, and AdreEmptyRosterError
 * if nobody in the file qualifies.
 */
export function parseAdreRoster(csvText: string, county: string): AzLicensee[] {
  const rows = parse(csvText, {
    columns: (header: string[]) => {
      const names = header.map((h) => h.trim());
      const missing = ADRE_REQUIRED_COLUMNS.filter((c) => !names.includes(c));
      if (missing.length > 0) throw new AdreFormatError(missing, names);
      return names;
    },
    skip_empty_lines: true,
    relax_column_count: true,
  }) as AdreRow[];

  const licensees: AzLicensee[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (col(row, "MailingCounty") !== county) continue;
    if (col(row, "LicStatus") !== "Active") continue;
    if (col(row, "LicCategory") !== "Real Estate") continue;
    const licenseType = col(row, "LicType");
    if (licenseType !== "Broker" && licenseType !== "Salesperson") continue;
    const name = formatName(row);
    if (!name) continue;

    const address = formatAddress(row);
    const key = licenseeKey(row, name, licenseType, address);
    if (seen.has(key)) continue;
    seen.add(key);

    licensees.push({
      key,
      name,
      brokerage: col(row, "EmployerDBAName") || col(row, "EmployerLegalName") || null,
      phone: col(row, "EmployerPhone") || null,
      address,
      city: col(row, "MailingCity") || null,
      licenseType,
    });
  }
  if (licensees.length === 0) throw new AdreEmptyRosterError(county, rows.length);
  return licensees;
}

/** Downloads ADRE's full roster CSV (there's no filtered download). */
export async function downloadAdreRoster(): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(ADRE_LIST_URL, { signal: controller.signal });
    if (!res.ok) throw new Error(`ADRE download failed (HTTP ${res.status})`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}
