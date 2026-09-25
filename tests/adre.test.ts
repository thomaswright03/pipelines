import { describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import * as log from "@/lib/log";
import { AdreEmptyRosterError, AdreFormatError, parseAdreRoster } from "@/lib/az-adre";
import { loadAdreRosterAction } from "@/lib/actions/dataleadsell";
import { getAdreStatus, loadAdreRoster, processAdreChunk } from "@/lib/adre-import";
import { page, stubFetch } from "./helpers";

const HEADER =
  "LicenseNumber,FirstName,MiddleName,LastName,LicStatus,LicCategory,LicType,MailingAddress1,MailingAddress2,MailingCity,MailingState,MailingZip,MailingCounty,EmployerDBAName,EmployerLegalName,EmployerPhone";

function row(n: number, fields: Record<string, string> = {}): string {
  const f: Record<string, string> = {
    LicenseNumber: `SA${String(n).padStart(6, "0")}`,
    FirstName: `First${n}`,
    MiddleName: "",
    LastName: `Last${n}`,
    LicStatus: "Active",
    LicCategory: "Real Estate",
    LicType: "Salesperson",
    MailingAddress1: `${n} Main St`,
    MailingAddress2: "",
    MailingCity: "Mesa",
    MailingState: "AZ",
    MailingZip: "85201",
    MailingCounty: "Maricopa",
    EmployerDBAName: "Test Realty",
    EmployerLegalName: "",
    EmployerPhone: "4805550100",
    ...fields,
  };
  return HEADER.split(",")
    .map((c) => f[c] ?? "")
    .join(",");
}

function roster(count: number, extra: string[] = []): string {
  return [HEADER, ...Array.from({ length: count }, (_, i) => row(i + 1)), ...extra].join("\n");
}

describe("parseAdreRoster", () => {
  it("keeps only active real-estate brokers and salespeople in the county, once each", () => {
    const csv = roster(2, [
      row(100, { LicStatus: "Expired" }),
      row(101, { MailingCounty: "Pima" }),
      row(102, { LicCategory: "Cemetery" }),
      row(103, { LicType: "Designated Broker Entity" }),
      row(1), // duplicate license number
    ]);
    const licensees = parseAdreRoster(csv, "Maricopa");
    expect(licensees.map((l) => l.name)).toEqual(["First1 Last1", "First2 Last2"]);
    expect(licensees[0]).toMatchObject({ key: "adre:SA000001", brokerage: "Test Realty", city: "Mesa" });
  });
});

describe("a roster whose format changed", () => {
  const ADRE_URL = "https://services.azre.gov/PdbWeb/List/DownloadList/1";

  it("is refused by the parser, naming the missing column", () => {
    const renamed = roster(3).replace("LicStatus", "LicenseStatus");
    expect(() => parseAdreRoster(renamed, "Maricopa")).toThrow(AdreFormatError);
    try {
      parseAdreRoster(renamed, "Maricopa");
    } catch (err) {
      expect((err as AdreFormatError).missing).toEqual(["LicStatus"]);
      expect((err as AdreFormatError).columns).toContain("LicenseStatus");
    }
  });

  it("is reported on the ADRE panel as a format change, with the columns received in the log", async () => {
    const logged = vi.spyOn(log, "logError").mockImplementation(() => {});
    stubFetch({ [ADRE_URL]: { body: roster(3).replace("LicStatus", "LicenseStatus"), contentType: "text/csv" } });

    expect(await loadAdreRosterAction()).toEqual({
      ok: false,
      error: "ADRE's roster format changed — the import can't read it, so nothing was changed. Ask your developer to update the import.",
    });
    expect(logged).toHaveBeenCalledWith(
      "action.loadAdreRoster",
      expect.any(AdreFormatError),
      expect.objectContaining({ columnsReceived: expect.stringContaining("LicenseStatus") }),
    );
    expect(await prisma.adreLicensee.count()).toBe(0);
    logged.mockRestore();
  });

  it("with the right columns but nobody in the county is reported as suspicious, not as success", async () => {
    vi.spyOn(log, "logError").mockImplementation(() => {});
    const noneInCounty = [HEADER, row(1, { MailingCounty: "Pima" }), row(2, { LicStatus: "Expired" })].join("\n");
    expect(() => parseAdreRoster(noneInCounty, "Maricopa")).toThrow(AdreEmptyRosterError);
    stubFetch({ [ADRE_URL]: { body: noneInCounty, contentType: "text/csv" } });

    expect(await loadAdreRosterAction()).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^ADRE's roster downloaded but lists no active Maricopa County/),
    });
    expect(await prisma.adreRoster.count()).toBe(0);
    vi.restoreAllMocks();
  });

  it("still imports a normal roster through the action", async () => {
    stubFetch({ [ADRE_URL]: { body: roster(5), contentType: "text/csv" } });
    expect(await loadAdreRosterAction()).toMatchObject({ ok: true, status: { total: 5 } });
  });
});

describe("ADRE import", () => {
  it("loads a 1,000-licensee roster once and never duplicates it on reload", async () => {
    const first = await loadAdreRoster(roster(1000));
    expect(first).toEqual({ total: 1000, added: 1000 });
    const again = await loadAdreRoster(roster(1000));
    expect(again).toEqual({ total: 1000, added: 0 });

    const status = await getAdreStatus();
    expect(status).toMatchObject({ loaded: true, total: 1000, checked: 0, remaining: 1000, needsLoad: false });
  });

  it("works through the roster in order, a chunk per call, without re-downloading", async () => {
    await loadAdreRoster(roster(12));
    const fetches = stubFetch({
      // Licensee 2 has their own site with their own address.
      "https://www.first2last2.com": page(`First2 Last2 homes — (480) 555-0100 — first2@first2last2.test`),
    });

    const one = await processAdreChunk();
    expect(one.checked).toBe(5);
    expect(one.created).toBe(1);
    expect(one.status).toMatchObject({ checked: 5, remaining: 7, created: 1 });

    const two = await processAdreChunk();
    expect(two.status).toMatchObject({ checked: 10, remaining: 2 });
    const three = await processAdreChunk();
    expect(three.status.remaining).toBe(0);
    const four = await processAdreChunk();
    expect(four.checked).toBe(0);

    const outcomes = await prisma.adreLicensee.findMany({ orderBy: { position: "asc" }, select: { outcome: true } });
    expect(outcomes.map((o) => o.outcome)).toEqual(["no_email", "created", ...Array(10).fill("no_email")]);
    expect(fetches.calls.some((u) => u.includes("azre.gov"))).toBe(false);
    expect(await prisma.agentLead.findFirstOrThrow()).toMatchObject({
      name: "First2 Last2",
      email: "first2@first2last2.test",
      source: "Arizona ADRE license roster",
      phone: "(480) 555-0100",
    });
  });

  it("leaves a licensee whose website timed out unchecked, and retries them an hour later", async () => {
    await loadAdreRoster(roster(2));
    stubFetch({
      // Licensee 1's brokerage site is down; licensee 2 has no site at all.
      "https://www.testrealty.com": () => ({ status: 503, body: "down" }),
    });

    const now = new Date();
    const first = await processAdreChunk({ now });
    expect(first).toMatchObject({ checked: 2, unreachable: 2 });
    expect(first.status).toMatchObject({ checked: 0, remaining: 0, retryLater: 2, needsLoad: false });
    expect((await prisma.adreLicensee.findFirstOrThrow({ orderBy: { position: "asc" } })).checkedAt).toBeNull();

    stubFetch({ "https://www.first1last1.com": page(`First1 Last1 homes — (480) 555-0100 — first1@first1last1.test`) });
    const later = await processAdreChunk({ now: new Date(now.getTime() + 61 * 60 * 1000) });
    expect(later).toMatchObject({ checked: 2, created: 1, unreachable: 0 });
    expect(later.status).toMatchObject({ checked: 2, retryLater: 0 });
  });
});
