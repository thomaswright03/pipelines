import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { parseAdreRoster } from "@/lib/az-adre";
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
    expect(outcomes.map((o) => o.outcome)).toEqual([
      "no_email",
      "created",
      ...Array(10).fill("no_email"),
    ]);
    expect(fetches.calls.some((u) => u.includes("azre.gov"))).toBe(false);
    expect(await prisma.agentLead.findFirstOrThrow()).toMatchObject({
      name: "First2 Last2",
      email: "first2@first2last2.test",
      source: "Arizona ADRE license roster",
      phone: "(480) 555-0100",
    });
  });
});
