// @vitest-environment jsdom
// The call deck (working through cards, a failed save, a reply that needs a
// look, a list longer than one deck), the dashboard card's editor, and the
// theme switch.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { deferred } from "./dom";
import type { CallDeck } from "@/lib/call-deck";

const router = { refresh: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const outreach = vi.hoisted(() => ({ confirmColdCallAction: vi.fn() }));
vi.mock("@/lib/actions/outreach", () => outreach);
const meta = vi.hoisted(() => ({ updatePipelineMetaAction: vi.fn() }));
vi.mock("@/lib/actions/pipeline-meta", () => meta);

const { default: ColdCallFlashcards } = await import("@/components/ColdCallFlashcards");
const { default: PipelineCard } = await import("@/components/PipelineCard");
const { default: ThemeToggle } = await import("@/components/ThemeToggle");

function card(id: string, name: string, extra: Partial<CallDeck["cards"][number]> = {}): CallDeck["cards"][number] {
  return {
    id,
    name,
    subtitle: null,
    phone: "(480) 555-0100",
    city: "Mesa",
    state: "AZ",
    emailed: "Emailed Sep 10, 2026",
    lastNote: null,
    review: null,
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();
});

describe("the call deck", () => {
  const deck: CallDeck = { cards: [card("a", "First Lead"), card("b", "Second Lead")], total: 2, offset: 0, nextAfter: null };

  it("asks for an outcome, saves the call, moves on, and summarises at the end", async () => {
    outreach.confirmColdCallAction.mockResolvedValue({ ok: true, message: "Saved" });
    render(<ColdCallFlashcards pipeline="cold-outreach" deck={deck} />);
    expect(screen.getByText("Card 1 of 2")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save and next" }));
    expect(await screen.findByText("Pick how the call went first.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Interested" }));
    fireEvent.change(screen.getByLabelText("Notes from the call"), { target: { value: "Call back Friday" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and next" }));
    expect(await screen.findByRole("heading", { name: "Second Lead" })).toBeTruthy();
    expect(outreach.confirmColdCallAction).toHaveBeenCalledWith("cold-outreach", "a", "interested", "Call back Friday");
    expect(screen.getByText("Card 2 of 2")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(await screen.findByRole("heading", { name: "Deck finished" })).toBeTruthy();
    expect(screen.getByText("You worked through 2 cards.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "First Lead" }).getAttribute("href")).toBe("/vault-pipeline/a");
    expect(screen.queryByRole("link", { name: "Load the next cards" })).toBeNull();
  });

  it("keeps the card and says so when the server refuses or can't be reached", async () => {
    render(<ColdCallFlashcards pipeline="dataleadsell" deck={deck} />);
    fireEvent.click(screen.getByRole("button", { name: "Didn't answer" }));

    outreach.confirmColdCallAction.mockResolvedValueOnce({ ok: false, error: "First Lead changed status a moment ago." });
    fireEvent.click(screen.getByRole("button", { name: "Save and next" }));
    expect(await screen.findByText("First Lead changed status a moment ago.")).toBeTruthy();

    const pending = deferred<never>();
    outreach.confirmColdCallAction.mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole("button", { name: "Save and next" }));
    expect(await screen.findByRole("button", { name: "Saving…" })).toHaveProperty("disabled", true);
    await act(async () => pending.reject(new TypeError("Failed to fetch")));
    expect(await screen.findByText(/couldn't confirm whether the call was saved\. Reload the page/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "First Lead" })).toBeTruthy();
  });

  it("puts a reply that needs a look at the top of the card", () => {
    const flagged: CallDeck = { ...deck, cards: [card("a", "Grumpy", { review: "The reply sounds like a complaint." })] };
    render(<ColdCallFlashcards pipeline="cold-outreach" deck={flagged} />);
    const note = screen.getByRole("note");
    expect(note.textContent).toContain("Reply needs a look before calling.");
    expect(note.textContent).toContain("The reply sounds like a complaint.");
  });

  it("shows the true size of a long list and offers the next batch at the end", async () => {
    const long: CallDeck = { cards: [card("a", "Only One")], total: 340, offset: 200, nextAfter: "a" };
    render(<ColdCallFlashcards pipeline="cold-outreach" deck={long} />);
    expect(screen.getByText("Card 201 of 340")).toBeTruthy();
    expect(screen.getByText(/This deck holds cards 201–201 of the 340 on the list — finish these to load the next ones\./)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(await screen.findByText("139 more leads are on the call list after this deck.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Load the next cards" }).getAttribute("href")).toBe("/vault-pipeline/cold-call?after=a");
    fireEvent.click(screen.getByRole("button", { name: "Start from the top" }));
    expect(router.push).toHaveBeenCalledWith("/vault-pipeline/cold-call");
  });

  it("says so when a later batch has nothing left", () => {
    render(<ColdCallFlashcards pipeline="cold-outreach" deck={{ cards: [], total: 3, offset: 3, nextAfter: null }} />);
    expect(screen.getByText(/No cards left after this point — 3 leads are on the call list\./)).toBeTruthy();
  });

  it("picks up where this tab left off", () => {
    sessionStorage.setItem(
      "call-deck:cold-outreach",
      JSON.stringify({ handled: ["a"], log: [{ lead: { id: "a", name: "First Lead" }, outcome: "no_answer" }] }),
    );
    render(<ColdCallFlashcards pipeline="cold-outreach" deck={deck} />);
    return screen.findByText("Card 2 of 2");
  });
});

describe("a dashboard card", () => {
  const fields = { name: "Cold Outreach", company: "Wright AI", productDescription: "Websites", pipelineDescription: "Emails businesses" };
  const numbers = { readyToEmail: 4, waitingOnReply: 3, onCallDeck: 2, replied: 1, needsALook: 2 };

  it("shows the pipeline's numbers and edits its copy", async () => {
    meta.updatePipelineMetaAction.mockResolvedValueOnce({ error: "Name can't be empty." }).mockResolvedValueOnce({});
    render(<PipelineCard pipelineId="cold-outreach" meta={fields} kind="internal" href="/vault-pipeline" numbers={numbers} />);
    expect(screen.getByRole("link", { name: "Ready to email: 4" }).getAttribute("href")).toBe("/vault-pipeline?status=new");
    expect(screen.getByText(/2 replies need a look/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Pipeline name"), { target: { value: "" } });
    fireEvent.submit(screen.getByRole("button", { name: "Save" }).closest("form")!);
    expect(await screen.findByText("Name can't be empty.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Pipeline name"), { target: { value: "Outreach" } });
    fireEvent.submit(screen.getByRole("button", { name: "Save" }).closest("form")!);
    await vi.waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
  });

  it("keeps a separately hosted system secondary, without developer wording", () => {
    render(<PipelineCard pipelineId="ai-lead-responder" meta={fields} kind="hosted" dashboardUrl="https://vercel.example/x" />);
    expect(screen.getByText("Runs separately")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Check that it's running ↗" }).getAttribute("target")).toBe("_blank");
    expect(screen.queryByText(/developer console/)).toBeNull();
  });

  it("cancels an edit without saving", () => {
    render(<PipelineCard pipelineId="cold-outreach" meta={fields} kind="internal" href="/vault-pipeline" numbers={numbers} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(meta.updatePipelineMetaAction).not.toHaveBeenCalled();
  });
});

describe("the theme switch", () => {
  it("applies and remembers a choice, and System forgets it", () => {
    render(<ThemeToggle />);
    const select = screen.getByLabelText("Color theme") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "dark" } });
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("theme")).toBe("dark");
    fireEvent.change(select, { target: { value: "system" } });
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(localStorage.getItem("theme")).toBeNull();
  });
});
