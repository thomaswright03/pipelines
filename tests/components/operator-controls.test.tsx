// @vitest-environment jsdom
// The long-running operator controls and the error pages: the email lookup
// sweep, the ADRE import, the pipeline's city searches, the Cold Outreach
// stage panel, and both error boundaries — each control's pending,
// progress, success, refusal and network-failure states.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { deferred } from "./dom";
import type { AdreStatusView } from "@/components/AdreImportPanel";

const router = { refresh: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const outreach = vi.hoisted(() => ({ findEmailsChunkAction: vi.fn(), previewBulkSendAction: vi.fn(), sendBulkChunkAction: vi.fn() }));
vi.mock("@/lib/actions/outreach", () => outreach);
const dataleadsell = vi.hoisted(() => ({
  loadAdreRosterAction: vi.fn(),
  processAdreChunkAction: vi.fn(),
  runAgentPipelineScrapeAction: vi.fn(),
  searchAgentsAction: vi.fn(),
}));
vi.mock("@/lib/actions/dataleadsell", () => dataleadsell);
const vault = vi.hoisted(() => ({
  runPipelineScrapeAction: vi.fn(),
  searchLeadsAction: vi.fn(),
  scheduleAppointmentAction: vi.fn(),
  markResponseAsNonDeliveryAction: vi.fn(),
}));
vi.mock("@/lib/actions/vault-pipeline", () => vault);

const { default: FindEmailsButton } = await import("@/components/FindEmailsButton");
const { default: AdreImportPanel } = await import("@/components/AdreImportPanel");
const { default: OutreachControls } = await import("@/components/OutreachControls");
const { default: ColdOutreachStagePanel } = await import("@/components/ColdOutreachStagePanel");
const { default: ErrorPage } = await import("@/app/error");
const { default: GlobalError } = await import("@/app/global-error");

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const findChunk = (result: { checked: number; found: number; unreachable: number; remaining: number }) => ({ ok: true, result });

describe("FindEmailsButton", () => {
  it("shows live progress with a Stop button, then a summary", async () => {
    const first = deferred<ReturnType<typeof findChunk>>();
    outreach.findEmailsChunkAction
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(findChunk({ checked: 2, found: 1, unreachable: 1, remaining: 0 }));
    render(<FindEmailsButton pipeline="cold-outreach" />);
    fireEvent.click(screen.getByRole("button", { name: "Look up emails for leads without one" }));

    expect(await screen.findByText(/Finding emails… 0 of \? looked up/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
    await act(async () => first.resolve(findChunk({ checked: 3, found: 2, unreachable: 0, remaining: 3 })));
    expect(await screen.findByText(/Checked 5 leads, found 3 emails\. Leads with none were moved to the phone lists\./)).toBeTruthy();
    expect(screen.getByText(/1 website couldn't be reached — those leads were left as they are/)).toBeTruthy();
    expect(outreach.findEmailsChunkAction).toHaveBeenCalledTimes(2);
    expect(router.refresh).toHaveBeenCalled();
  });

  it("stops after the batch in progress when Stop is pressed", async () => {
    const first = deferred<ReturnType<typeof findChunk>>();
    outreach.findEmailsChunkAction.mockReturnValueOnce(first.promise);
    render(<FindEmailsButton pipeline="dataleadsell" />);
    fireEvent.click(screen.getByRole("button", { name: "Look up emails for agents without one" }));
    fireEvent.click(await screen.findByRole("button", { name: "Stop" }));
    expect(screen.getByRole("button", { name: "Stopping…" })).toHaveProperty("disabled", true);
    await act(async () => first.resolve(findChunk({ checked: 1, found: 1, unreachable: 0, remaining: 9 })));
    expect(await screen.findByText(/^Stopped\. Checked 1 agent, found 1 email\..* 9 still to check\.$/)).toBeTruthy();
    expect(outreach.findEmailsChunkAction).toHaveBeenCalledTimes(1);
  });

  it("says when every lead was already checked", async () => {
    outreach.findEmailsChunkAction.mockResolvedValue(findChunk({ checked: 0, found: 0, unreachable: 0, remaining: 0 }));
    render(<FindEmailsButton pipeline="cold-outreach" />);
    fireEvent.click(screen.getByRole("button", { name: /Look up emails/ }));
    expect(await screen.findByText("Every lead has already been checked for an email.")).toBeTruthy();
  });

  it("shows the server's refusal with the progress so far", async () => {
    outreach.findEmailsChunkAction.mockResolvedValue({ ok: false, error: "The database can't be reached right now." });
    render(<FindEmailsButton pipeline="cold-outreach" />);
    fireEvent.click(screen.getByRole("button", { name: /Look up emails/ }));
    expect(await screen.findByText(/^The database can't be reached right now\. Checked 0 leads/)).toBeTruthy();
  });

  it("says contact was lost when the request itself fails, and that progress is saved", async () => {
    outreach.findEmailsChunkAction.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<FindEmailsButton pipeline="cold-outreach" />);
    fireEvent.click(screen.getByRole("button", { name: /Look up emails/ }));
    expect(await screen.findByText(/^Lost contact with the server\. Progress so far is saved/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Look up emails/ })).toBeTruthy();
  });
});

const ADRE_NOT_LOADED: AdreStatusView = {
  loaded: false,
  loadedAtLabel: null,
  total: 0,
  checked: 0,
  created: 0,
  remaining: 0,
  retryLater: 0,
  needsLoad: true,
};
const adreStatus = (over: Partial<AdreStatusView>): AdreStatusView => ({ ...ADRE_NOT_LOADED, loaded: true, needsLoad: false, ...over });

describe("AdreImportPanel", () => {
  it("downloads the roster first, then works through it with progress, and says when it's done", async () => {
    const load = deferred<{ ok: true; status: ReturnType<typeof adreStatus> }>();
    dataleadsell.loadAdreRosterAction.mockReturnValue(load.promise);
    dataleadsell.processAdreChunkAction
      .mockResolvedValueOnce({
        ok: true,
        result: { checked: 5, created: 2, unreachable: 0, status: adreStatus({ total: 8, checked: 5, created: 2, remaining: 3 }) },
      })
      .mockResolvedValueOnce({
        ok: true,
        result: { checked: 3, created: 1, unreachable: 1, status: adreStatus({ total: 8, checked: 8, created: 3, remaining: 0 }) },
      });
    render(<AdreImportPanel initial={ADRE_NOT_LOADED} />);
    expect(screen.getByText(/Not loaded yet/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Import Maricopa agents (ADRE)" }));
    expect(await screen.findByText("Downloading ADRE's roster…")).toBeTruthy();
    await act(async () => load.resolve({ ok: true, status: adreStatus({ total: 8, remaining: 8 }) }));

    expect(await screen.findByText(/^Done — the whole roster has been checked\. Checked 8 licensees and added 3 new agents/)).toBeTruthy();
    expect(screen.getByText(/1 website couldn't be reached; those licensees will be checked again in an hour/)).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "ADRE import progress" }).getAttribute("aria-valuenow")).toBe("100");
    expect(screen.getByRole("button", { name: "ADRE roster fully checked" })).toHaveProperty("disabled", true);
  });

  it("shows how far it got and a Stop button while checking; Stop ends after the current batch", async () => {
    const chunk = deferred<unknown>();
    dataleadsell.processAdreChunkAction.mockReturnValueOnce(chunk.promise);
    render(<AdreImportPanel initial={adreStatus({ total: 100, checked: 40, remaining: 60, loadedAtLabel: "Sep 1" })} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue ADRE import (60 left)" }));
    expect(await screen.findByText("Checking licensees… 0 checked, 0 added this run.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await act(async () =>
      chunk.resolve({
        ok: true,
        result: { checked: 5, created: 1, unreachable: 0, status: adreStatus({ total: 100, checked: 45, remaining: 55 }) },
      }),
    );
    expect(await screen.findByText(/^Stopped\. Checked 5 licensees and added 1 new agent this run; 55 left\.$/)).toBeTruthy();
    expect(dataleadsell.processAdreChunkAction).toHaveBeenCalledTimes(1);
  });

  it("reports a roster download the server refused, and changes nothing", async () => {
    dataleadsell.loadAdreRosterAction.mockResolvedValue({ ok: false, error: "ADRE's site didn't answer — try again later." });
    render(<AdreImportPanel initial={ADRE_NOT_LOADED} />);
    fireEvent.click(screen.getByRole("button", { name: "Import Maricopa agents (ADRE)" }));
    expect(await screen.findByText("ADRE's site didn't answer — try again later.")).toBeTruthy();
    expect(dataleadsell.processAdreChunkAction).not.toHaveBeenCalled();
  });

  it("says contact was lost during the download or the checks", async () => {
    dataleadsell.loadAdreRosterAction.mockRejectedValue(new TypeError("Failed to fetch"));
    const { unmount } = render(<AdreImportPanel initial={{ ...ADRE_NOT_LOADED, loaded: true, loadedAtLabel: "Aug 1" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh ADRE roster and continue" }));
    expect(await screen.findByText(/^Lost contact with the server while downloading the roster/)).toBeTruthy();
    unmount();

    dataleadsell.processAdreChunkAction.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<AdreImportPanel initial={adreStatus({ total: 10, remaining: 10 })} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue ADRE import (10 left)" }));
    expect(await screen.findByText(/^Lost contact with the server\. Progress so far is saved — click again to continue\./)).toBeTruthy();
  });

  it("shows a batch the server refused", async () => {
    dataleadsell.processAdreChunkAction.mockResolvedValue({ ok: false, error: "Something went wrong — progress so far is saved." });
    render(<AdreImportPanel initial={adreStatus({ total: 10, remaining: 10 })} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue ADRE import (10 left)" }));
    expect(await screen.findByText(/^Something went wrong — progress so far is saved\. Checked 0 licensees/)).toBeTruthy();
  });

  it("names the licensees waiting to be retried", () => {
    render(<AdreImportPanel initial={adreStatus({ total: 10, checked: 8, retryLater: 2, loadedAtLabel: "Sep 1" })} />);
    expect(screen.getByRole("button", { name: "2 waiting to retry" })).toHaveProperty("disabled", true);
    expect(screen.getByText(/2 whose website couldn't be reached will be checked again within the hour/)).toBeTruthy();
  });
});

describe("OutreachControls: searching a specific city", () => {
  const controls = (pipeline: "cold-outreach" | "dataleadsell") => (
    <OutreachControls pipeline={pipeline} paused={false} unsent={0} dailyRunUnsent={null} blocked={0} nextCity="Mesa, AZ" />
  );

  it("checks the city and state before searching, then shows the result", async () => {
    vault.searchLeadsAction.mockResolvedValue({ message: "Searched Tempe, AZ: found 2 new addresses." });
    render(controls("cold-outreach"));
    fireEvent.click(screen.getByRole("button", { name: "Search a specific city" }));
    const form = screen.getByRole("button", { name: "Search" }).closest("form")!;

    fireEvent.submit(form);
    expect(await screen.findByText("Enter a city.")).toBeTruthy();
    fireEvent.change(within(form).getByLabelText("City"), { target: { value: "Tempe" } });
    fireEvent.submit(form);
    expect(await screen.findByText("Pick a state.")).toBeTruthy();
    expect(vault.searchLeadsAction).not.toHaveBeenCalled();

    fireEvent.change(within(form).getByLabelText("State"), { target: { value: "AZ" } });
    fireEvent.change(within(form).getByLabelText("Business type (optional)"), { target: { value: "dentist" } });
    fireEvent.submit(form);
    expect(await screen.findByText("Searched Tempe, AZ: found 2 new addresses.")).toBeTruthy();
    const data = vault.searchLeadsAction.mock.calls[0]![1] as FormData;
    expect(Object.fromEntries(data)).toEqual({ city: "Tempe", state: "AZ", businessType: "dentist" });
  });

  it("shows a search the server refused", async () => {
    vault.searchLeadsAction.mockResolvedValue({ error: "Yelp didn't recognise that location — check the city and state." });
    render(controls("cold-outreach"));
    fireEvent.click(screen.getByRole("button", { name: "Search a specific city" }));
    const form = screen.getByRole("button", { name: "Search" }).closest("form")!;
    fireEvent.change(within(form).getByLabelText("City"), { target: { value: "Nowhere" } });
    fireEvent.change(within(form).getByLabelText("State"), { target: { value: "AZ" } });
    fireEvent.submit(form);
    expect(await screen.findByText(/Yelp didn't recognise that location/)).toBeTruthy();
  });

  it("offers only the sold counties' cities for agents, and searches the one picked", async () => {
    dataleadsell.searchAgentsAction.mockResolvedValue({ message: "Searched Provo: found 1 new agent." });
    dataleadsell.runAgentPipelineScrapeAction.mockResolvedValue({ ok: true, message: "Searched Mesa: found 0 new agents." });
    render(controls("dataleadsell"));
    fireEvent.click(screen.getByRole("button", { name: "Find agents in the next city" }));
    expect(await screen.findByText("Searched Mesa: found 0 new agents.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Search a specific city" }));
    const search = screen.getByRole("button", { name: "Search" });
    expect(search).toHaveProperty("disabled", true); // no city picked yet
    const form = search.closest("form")!;
    fireEvent.change(within(form).getByLabelText("County"), { target: { value: "Utah" } });
    fireEvent.change(within(form).getByLabelText("City"), { target: { value: "Provo" } });
    fireEvent.submit(form);
    expect(await screen.findByText("Searched Provo: found 1 new agent.")).toBeTruthy();
    // The earlier run's message belongs to the earlier control, so it's gone.
    expect(screen.queryByText("Searched Mesa: found 0 new agents.")).toBeNull();
  });
});

describe("ColdOutreachStagePanel", () => {
  const lead = { id: "l1", name: "Acme Plumbing", status: "responded", email: "a@acme.test", replied: true };

  it("sets an appointment, asking for a date first", async () => {
    const pending = deferred<{ ok: true; message: string }>();
    vault.scheduleAppointmentAction.mockReturnValue(pending.promise);
    render(<ColdOutreachStagePanel lead={lead} appointmentInputValue="" />);
    fireEvent.click(screen.getByRole("button", { name: "Set" }));
    expect(await screen.findByText("Pick a date and time for the appointment.")).toBeTruthy();
    expect(vault.scheduleAppointmentAction).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Appointment/), { target: { value: "2030-01-02T10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Set" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Set" })).toHaveProperty("disabled", true));
    await act(async () => pending.resolve({ ok: true, message: "Appointment with Acme Plumbing set — moved to Appointment set." }));
    expect(await screen.findByText(/Appointment with Acme Plumbing set/)).toBeTruthy();
    expect(vault.scheduleAppointmentAction).toHaveBeenCalledWith("l1", "2030-01-02T10:00");
  });

  it("offers Update for an existing appointment, and reports a refusal or a lost connection", async () => {
    vault.scheduleAppointmentAction
      .mockResolvedValueOnce({ ok: false, error: "Pick a time in the future." })
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<ColdOutreachStagePanel lead={{ ...lead, status: "appointment_set" }} appointmentInputValue="2020-01-01T09:00" />);
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    expect(await screen.findByText("Pick a time in the future.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    expect(await screen.findByText("Couldn't reach the server — nothing was changed. Try again.")).toBeTruthy();
  });

  it("turns a reply that was really a bounce into a bounce, after asking", async () => {
    vault.markResponseAsNonDeliveryAction.mockResolvedValue({
      ok: true,
      message: "Recorded the bounce for Acme Plumbing — moved to Cold call list.",
    });
    render(<ColdOutreachStagePanel lead={lead} appointmentInputValue="" />);
    fireEvent.click(screen.getByRole("button", { name: "That reply was a bounce" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(vault.markResponseAsNonDeliveryAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "That reply was a bounce" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Record as bounce" }));
    expect(await screen.findByText(/Recorded the bounce for Acme Plumbing/)).toBeTruthy();
  });

  it("shows nothing when no stage action fits the lead", () => {
    const { container } = render(<ColdOutreachStagePanel lead={{ ...lead, status: "lost", replied: false }} appointmentInputValue="" />);
    expect(container.innerHTML).toBe("");
  });
});

describe("the error pages", () => {
  function health(response: Promise<Response>) {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => response),
    );
  }

  it("says something went wrong in plain words, with Try again and a way back", async () => {
    health(Promise.resolve(new Response("{}", { status: 200 })));
    const retry = vi.fn();
    render(<ErrorPage error={new Error("boom")} retry={retry} />);
    expect(await screen.findByText("Something went wrong.")).toBeTruthy();
    expect(screen.getByText(/That's on us, not you/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to dashboard" }).getAttribute("href")).toBe("/");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/boom/)).toBeNull(); // never the raw error
  });

  it("says the database can't be reached when that is the cause", async () => {
    health(Promise.resolve(new Response("{}", { status: 503 })));
    const retry = vi.fn();
    render(<ErrorPage error={new Error("boom")} retry={retry} />);
    expect(await screen.findByText("Can't reach the database right now")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
  });

  it("falls back to the plain message when the health check itself fails", async () => {
    health(Promise.reject(new TypeError("Failed to fetch")));
    render(<ErrorPage error={new Error("boom")} retry={vi.fn()} />);
    expect(await screen.findByText("Something went wrong.")).toBeTruthy();
  });

  it("the whole-app fallback says what happened, offers Try again, and keeps the copyright line", () => {
    const retry = vi.fn();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {}); // <html> inside the test's <div>
    render(<GlobalError error={new Error("boom")} retry={retry} />);
    errors.mockRestore();
    expect(screen.getByText("Something went wrong.")).toBeTruthy();
    expect(screen.getByText("That's on us, not you. Try again.")).toBeTruthy();
    expect(screen.getByText(new RegExp(`© ${new Date().getFullYear()} Wright AI Solutions LLC`))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
