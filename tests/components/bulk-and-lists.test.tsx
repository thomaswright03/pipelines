// @vitest-environment jsdom
// The bulk-send dialog, the do-not-email list and the unmatched-replies
// list: preview, progress and outcome of a bulk send, and the pending,
// success, refusal and network-failure states of each control.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { deferred } from "./dom";
import type { BulkChunkResult, BulkPreview } from "@/lib/outreach/send";

const router = { refresh: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const outreach = vi.hoisted(() => ({ previewBulkSendAction: vi.fn(), sendBulkChunkAction: vi.fn() }));
vi.mock("@/lib/actions/outreach", () => outreach);
const settings = vi.hoisted(() => ({ addSuppressionAction: vi.fn(), removeSuppressionByEmailAction: vi.fn() }));
vi.mock("@/lib/actions/settings", () => settings);
const replies = vi.hoisted(() => ({ attachReplyAction: vi.fn(), dismissReplyAction: vi.fn(), searchLeadsForReplyAction: vi.fn() }));
vi.mock("@/lib/actions/replies", () => replies);

const { default: BulkSendButton } = await import("@/components/BulkSendButton");
const { DoNotEmailRows, AddSuppressionForm } = await import("@/components/DoNotEmailList");
const { default: UnmatchedReplies } = await import("@/components/UnmatchedReplies");

const PREVIEW: BulkPreview = {
  paused: false,
  totalEligible: 3,
  leadIds: ["a", "b", "c"],
  willSend: 3,
  distinctAddresses: 3,
  sample: [
    { name: "Acme", email: "a@acme.test" },
    { name: "Bolt", email: "b@bolt.test" },
  ],
  skipped: { duplicateInBatch: 0, alreadyPitched: 0, suppressed: 0 },
  batchLimit: 50,
};

function chunk(ids: string[], result: Partial<BulkChunkResult>): { ok: true; result: BulkChunkResult } {
  return {
    ok: true,
    result: {
      processedIds: [ids[0]!],
      sent: 0,
      skipped: 0,
      failed: 0,
      refused: 0,
      messages: [],
      stop: null,
      consecutiveFailures: 0,
      ...result,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("BulkSendButton", () => {
  it("is disabled when told to be (paused, or nothing to send)", () => {
    render(<BulkSendButton pipeline="cold-outreach" disabled />);
    expect(screen.getByRole("button", { name: "Send outreach to new leads…" })).toHaveProperty("disabled", true);
  });

  it("calls the records agents on the dataleadsell page", async () => {
    outreach.previewBulkSendAction.mockResolvedValue({ ok: true, preview: PREVIEW });
    render(<BulkSendButton pipeline="dataleadsell" />);
    fireEvent.click(screen.getByRole("button", { name: "Send outreach to new agents…" }));
    expect(await screen.findByRole("button", { name: "Send to 3 agents" })).toBeTruthy();
    expect(screen.getByText(/Each agent moves to Contacted/)).toBeTruthy();
    expect(screen.queryByText(/\blead\b/)).toBeNull();
  });

  it("previews who would be emailed, then sends and names refused addresses in the summary", async () => {
    outreach.previewBulkSendAction.mockResolvedValue({ ok: true, preview: PREVIEW });
    outreach.sendBulkChunkAction
      .mockImplementationOnce(async (_p: string, ids: string[]) => chunk(ids, { sent: 1 }))
      .mockImplementationOnce(async (_p: string, ids: string[]) =>
        chunk(ids, { refused: 1, messages: ["Bolt: The recipient's mail server refused this address — nothing was sent."] }),
      )
      .mockImplementationOnce(async (_p: string, ids: string[]) => chunk(ids, { sent: 1 }));
    render(<BulkSendButton pipeline="cold-outreach" />);

    fireEvent.click(screen.getByRole("button", { name: "Send outreach to new leads…" }));
    expect(await screen.findByText(/Acme — a@acme.test/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send to 3 leads" }));

    const summary = await screen.findByText(/^Sent 2 of 3\./);
    expect(summary.textContent).toContain("1 address refused by the recipient's mail server");
    expect(summary.className).toContain("notice-warning");
    expect(screen.getByText(/Bolt: The recipient's mail server refused/)).toBeTruthy();
    expect(outreach.sendBulkChunkAction).toHaveBeenCalledTimes(3);
    expect(router.refresh).toHaveBeenCalled();
  });

  it("shows progress while sending, and Stop takes effect after the email in progress", async () => {
    outreach.previewBulkSendAction.mockResolvedValue({ ok: true, preview: PREVIEW });
    const first = deferred<ReturnType<typeof chunk>>();
    outreach.sendBulkChunkAction.mockReturnValueOnce(first.promise);
    render(<BulkSendButton pipeline="cold-outreach" />);
    fireEvent.click(screen.getByRole("button", { name: "Send outreach to new leads…" }));
    fireEvent.click(await screen.findByRole("button", { name: "Send to 3 leads" }));

    expect(await screen.findByRole("progressbar", { name: "Send progress" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop sending" }));
    expect(screen.getByRole("button", { name: "Stopping after this email…" })).toHaveProperty("disabled", true);

    await act(async () => first.resolve(chunk(["a"], { sent: 1 })));
    expect(await screen.findByText(/Sent 1 of 3\. You stopped the send\./)).toBeTruthy();
    expect(outreach.sendBulkChunkAction).toHaveBeenCalledTimes(1);
  });

  it("offers no send while paused", async () => {
    outreach.previewBulkSendAction.mockResolvedValue({ ok: true, preview: { ...PREVIEW, paused: true } });
    render(<BulkSendButton pipeline="cold-outreach" />);
    fireEvent.click(screen.getByRole("button", { name: "Send outreach to new leads…" }));
    expect(await screen.findByText(/Outbound email is paused/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Send to/ })).toBeNull();
  });

  it("says nothing was sent when the preview can't reach the server", async () => {
    outreach.previewBulkSendAction.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<BulkSendButton pipeline="cold-outreach" />);
    fireEvent.click(screen.getByRole("button", { name: "Send outreach to new leads…" }));
    expect(await screen.findByText(/Couldn't reach the server — nothing was sent/)).toBeTruthy();
  });
});

describe("Do-not-email list", () => {
  const rows = [{ email: "stop@x.test", since: "Sep 25, 2026", why: "Knock it off." }];

  it("removes an address only after confirming, and reports the result", async () => {
    settings.removeSuppressionByEmailAction.mockResolvedValue({ ok: true, message: "Removed stop@x.test from the list." });
    render(<DoNotEmailRows rows={rows} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove from list" }));
    expect(await screen.findByText("Removed stop@x.test from the list.")).toBeTruthy();
    expect(settings.removeSuppressionByEmailAction).toHaveBeenCalledWith("stop@x.test");
  });

  it("says the list didn't change when the server can't be reached", async () => {
    settings.removeSuppressionByEmailAction.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<DoNotEmailRows rows={rows} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove from list" }));
    expect(await screen.findByText(/Couldn't reach the server — the list didn't change/)).toBeTruthy();
  });

  it("adding: asks for an address, shows the pending state, and clears the form on success", async () => {
    const pending = deferred<{ ok: true; message: string }>();
    settings.addSuppressionAction.mockReturnValue(pending.promise);
    render(<AddSuppressionForm />);

    fireEvent.click(screen.getByRole("button", { name: "Add to list" }));
    expect(await screen.findByText("Enter the address to stop emailing.")).toBeTruthy();
    expect(settings.addSuppressionAction).not.toHaveBeenCalled();

    const address = screen.getByLabelText("Address") as HTMLInputElement;
    fireEvent.change(address, { target: { value: "new@x.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to list" }));
    expect(await screen.findByRole("button", { name: "Adding…" })).toHaveProperty("disabled", true);

    await act(async () => pending.resolve({ ok: true, message: "Added new@x.test to the do-not-email list." }));
    expect(await screen.findByText("Added new@x.test to the do-not-email list.")).toBeTruthy();
    expect(address.value).toBe("");
  });

  it("adding: shows a refusal and keeps what was typed", async () => {
    settings.addSuppressionAction.mockResolvedValue({ ok: false, error: "That isn't an email address." });
    render(<AddSuppressionForm />);
    const address = screen.getByLabelText("Address") as HTMLInputElement;
    fireEvent.change(address, { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to list" }));
    expect(await screen.findByText("That isn't an email address.")).toBeTruthy();
    expect(address.value).toBe("nope");
  });
});

describe("Unmatched replies", () => {
  const reply = {
    id: "r1",
    fromEmail: "assistant@acme.test",
    subject: "Re: hello",
    text: "Forwarding to the owner.",
    optedOut: false,
    bounce: false,
    kindReason: null,
    receivedAt: "Sep 25, 2026",
  };
  const match = {
    pipeline: "cold-outreach" as const,
    pipelineLabel: "Cold Outreach",
    id: "lead-1",
    name: "Acme Plumbing",
    email: "owner@acme.test",
    status: "Contacted",
  };

  it("says when there is nothing to match", () => {
    render(<UnmatchedReplies replies={[]} />);
    expect(screen.getByText(/Nothing to match/)).toBeTruthy();
  });

  it("needs two letters to search, then attaches the reply to the lead picked", async () => {
    replies.searchLeadsForReplyAction.mockResolvedValue({ ok: true, leads: [match] });
    replies.attachReplyAction.mockResolvedValue({ ok: true, message: "Added the reply to Acme Plumbing." });
    render(<UnmatchedReplies replies={[reply]} />);

    const box = screen.getByPlaceholderText("Name, company or email");
    fireEvent.change(box, { target: { value: "a" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText(/Type at least two letters/)).toBeTruthy();

    fireEvent.change(box, { target: { value: "acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.click(await screen.findByRole("button", { name: "Attach" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add reply" }));
    expect(await screen.findByText("Added the reply to Acme Plumbing.")).toBeTruthy();
    expect(replies.attachReplyAction).toHaveBeenCalledWith("r1", "cold-outreach", "lead-1");
  });

  it("reports a failed search and a failed dismiss plainly", async () => {
    replies.searchLeadsForReplyAction.mockRejectedValue(new TypeError("Failed to fetch"));
    replies.dismissReplyAction.mockResolvedValue({ ok: false, error: "That reply was already dismissed." });
    render(<UnmatchedReplies replies={[reply]} />);
    fireEvent.change(screen.getByPlaceholderText("Name, company or email"), { target: { value: "acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText("Couldn't reach the server — try again.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(await screen.findByText("Dismiss the reply from assistant@acme.test?")).toBeTruthy();
    const dialogConfirm = screen.getAllByRole("button", { name: "Dismiss" });
    expect(dialogConfirm).toHaveLength(2);
    fireEvent.click(dialogConfirm[0]!); // the dialog comes first in the item
    await waitFor(() => expect(screen.getByText("That reply was already dismissed.")).toBeTruthy());
  });
});
