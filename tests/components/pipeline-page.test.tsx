// @vitest-environment jsdom
// The pipeline page's controls and lists: the next city, what the daily
// run will and won't email, the last run's outcome, and the lead list's
// markers (last send failed, won't be auto-sent, reply needs a look).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { deferred } from "./dom";

const router = { refresh: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/form", () => ({ default: ({ children }: { children: React.ReactNode }) => <form>{children}</form> }));

const vault = vi.hoisted(() => ({ runPipelineScrapeAction: vi.fn(), searchLeadsAction: vi.fn(async () => ({})) }));
vi.mock("@/lib/actions/vault-pipeline", () => vault);
vi.mock("@/lib/actions/dataleadsell", () => ({ runAgentPipelineScrapeAction: vi.fn(), searchAgentsAction: vi.fn(async () => ({})) }));
vi.mock("@/lib/actions/outreach", () => ({
  previewBulkSendAction: vi.fn(),
  sendBulkChunkAction: vi.fn(),
  findEmailsBulkAction: vi.fn(),
  setStarredAction: vi.fn(),
}));
vi.mock("@/lib/actions/pipeline-schedule", () => ({ updateVaultScheduleAction: vi.fn(async () => ({})) }));

const { default: OutreachControls } = await import("@/components/OutreachControls");
const { default: VaultScheduleSettings } = await import("@/components/VaultScheduleSettings");
const { default: LeadTable } = await import("@/components/LeadTable");

beforeEach(() => vi.clearAllMocks());

describe("OutreachControls", () => {
  it("names the next city before the search runs, and reports the result", async () => {
    const pending = deferred<{ ok: true; message: string }>();
    vault.runPipelineScrapeAction.mockReturnValue(pending.promise);
    render(<OutreachControls pipeline="cold-outreach" paused={false} unsent={0} dailyRunUnsent={0} blocked={0} nextCity="Mesa, AZ" />);
    expect(screen.getByText("Mesa, AZ")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Find leads in the next city" }));
    expect(await screen.findByRole("button", { name: "Searching… (up to a minute)" })).toHaveProperty("disabled", true);
    await act(async () => pending.resolve({ ok: true, message: "Searched Mesa, AZ: found 3 new addresses." }));
    expect(await screen.findByText("Searched Mesa, AZ: found 3 new addresses.")).toBeTruthy();
  });

  it("says a failed search couldn't reach the server", async () => {
    vault.runPipelineScrapeAction.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<OutreachControls pipeline="cold-outreach" paused={false} unsent={0} dailyRunUnsent={0} blocked={0} nextCity="Mesa, AZ" />);
    fireEvent.click(screen.getByRole("button", { name: "Find leads in the next city" }));
    expect(await screen.findByText(/couldn't confirm whether the search ran/)).toBeTruthy();
  });

  it("tells hand-added leads apart from the ones the daily run will email", () => {
    const { rerender } = render(
      <OutreachControls pipeline="cold-outreach" paused={false} unsent={3} dailyRunUnsent={2} blocked={0} nextCity="Mesa, AZ" />,
    );
    expect(screen.getByText(/The next daily run will email the 2 it found; the other 1/)).toBeTruthy();
    rerender(<OutreachControls pipeline="cold-outreach" paused={false} unsent={1} dailyRunUnsent={0} blocked={0} nextCity="Mesa, AZ" />);
    expect(screen.getByText(/The daily run only emails leads it found itself/)).toBeTruthy();
    rerender(<OutreachControls pipeline="dataleadsell" paused={false} unsent={1} blocked={0} nextCity="Provo (Utah County, UT)" />);
    expect(screen.getByText(/only emailed when you press Send outreach/)).toBeTruthy();
  });

  it("disables the bulk send and says so while paused", () => {
    render(<OutreachControls pipeline="cold-outreach" paused unsent={3} dailyRunUnsent={3} blocked={1} nextCity="Mesa, AZ" />);
    expect(screen.getByRole("button", { name: "Send outreach to new leads…" })).toHaveProperty("disabled", true);
    expect(screen.getByText(/Outbound email is paused — sending is off/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /1 New lead with an address is held back/ })).toBeTruthy();
  });
});

describe("VaultScheduleSettings: the last run", () => {
  const schedule = { enabled: true, emailsPerDay: 30 };
  const base = { runTimeLabel: "8:33 AM Arizona time", paused: false, staleWarning: null };

  it("leads with a failed run's outcome and its first problem", () => {
    render(
      <VaultScheduleSettings
        {...base}
        schedule={schedule}
        runs={[
          {
            id: "r2",
            status: "failed",
            startedAt: "Sep 26, 2026, 8:33 AM MST",
            summary: "Couldn't search Mesa, AZ on Yelp, so no new leads were found, emailed 0.",
            errors: ["Search of Mesa, AZ failed: Yelp didn't answer."],
            numbers: { businessesChecked: 0, leadsFound: 0, emailsSent: 0 },
          },
        ]}
      />,
    );
    const line = screen.getByText(/Last run \(Sep 26/).closest("p")!;
    expect(line.textContent).toMatch(/^Failed/);
    expect(line.textContent).toContain("First problem: Search of Mesa, AZ failed");
  });

  it("shows a successful run's numbers without a problem line", () => {
    render(
      <VaultScheduleSettings
        {...base}
        schedule={schedule}
        runs={[
          {
            id: "r1",
            status: "succeeded",
            startedAt: "Sep 25",
            summary: "ok",
            errors: [],
            numbers: { businessesChecked: 30, leadsFound: 6, emailsSent: 6 },
          },
        ]}
      />,
    );
    const line = screen.getByText(/Last run \(Sep 25\)/).closest("p")!;
    expect(line.textContent).toMatch(/^Succeeded.*checked 30 businesses, found 6 addresses, emailed 6 leads\.$/);
  });
});

describe("LeadTable markers", () => {
  it("marks a lead whose last send failed, one that won't be auto-sent, and a reply that needs a look", () => {
    const row = {
      id: "l1",
      name: "Gone Shop",
      subtitle: null,
      location: "Mesa, AZ",
      email: "gone@nowhere.test",
      phone: null,
      status: "new",
      lastEmailedAt: null,
      createdAt: new Date("2026-09-20T12:00:00Z"),
      starred: false,
      flagged: true,
      lastSendFailure: "The recipient's mail server refused this address — nothing was sent.",
      needsReview: true,
    };
    render(
      <LeadTable
        pipeline="cold-outreach"
        basePath="/vault-pipeline"
        params={{ status: null, q: "", sort: "created", dir: "desc", page: 1 }}
        rows={[row]}
        filteredTotal={1}
        total={1}
        statuses={["new"]}
        statusCounts={{ new: 1 }}
        locationLabel="Location"
        noun={{ one: "lead", many: "leads" }}
      />,
    );
    const failed = screen.getAllByText("Last send failed");
    expect(failed.length).toBeGreaterThan(0);
    expect(failed[0]!.getAttribute("title")).toMatch(/refused this address/);
    expect(screen.getAllByText("Won't be auto-sent").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Reply needs a look").length).toBeGreaterThan(0);
  });
});
