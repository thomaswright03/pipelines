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
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const outreach = vi.hoisted(() => ({ previewBulkSendAction: vi.fn(), sendBulkChunkAction: vi.fn() }));
vi.mock("@/lib/actions/outreach", () => outreach);
const settings = vi.hoisted(() => ({
  addSuppressionAction: vi.fn(),
  removeSuppressionByEmailAction: vi.fn(),
  startReplyCheckAction: vi.fn(),
}));
vi.mock("@/lib/actions/settings", () => settings);
const replies = vi.hoisted(() => ({
  attachReplyAction: vi.fn(),
  dismissReplyAction: vi.fn(),
  optOutReplyAction: vi.fn(),
  searchLeadsForReplyAction: vi.fn(),
}));
vi.mock("@/lib/actions/replies", () => replies);

const { default: BulkSendButton } = await import("@/components/BulkSendButton");
const { DoNotEmailRows, AddSuppressionForm } = await import("@/components/DoNotEmailList");
const { default: UnmatchedReplies } = await import("@/components/UnmatchedReplies");
const { default: ReplyCheck } = await import("@/components/ReplyCheck");

const PREVIEW: BulkPreview = {
  paused: false,
  pausedByEnvironment: false,
  totalEligible: 3,
  leadIds: ["a", "b", "c"],
  willSend: 3,
  distinctAddresses: 3,
  sample: [
    { name: "Acme", email: "a@acme.test" },
    { name: "Bolt", email: "b@bolt.test" },
  ],
  skipped: {
    neverPitch: 0,
    duplicateInBatch: 0,
    alreadyPitched: 0,
    suppressed: 0,
    refusedEarlier: 0,
    replyNeedsLook: 0,
    alreadyAnswered: 0,
  },
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

  it("when sending is switched off by the hosting, says so plainly, with the setting only in a developer line", async () => {
    outreach.previewBulkSendAction.mockResolvedValue({ ok: true, preview: { ...PREVIEW, paused: true, pausedByEnvironment: true } });
    render(<BulkSendButton pipeline="cold-outreach" />);
    fireEvent.click(screen.getByRole("button", { name: "Send outreach to new leads…" }));
    const lead = await screen.findByText(/^Sending is switched off by whoever manages the app's hosting/);
    expect(lead.textContent).not.toMatch(/OUTBOUND_EMAIL_DISABLED|redeploy/);
    expect(screen.getByText(/^For your developer: the OUTBOUND_EMAIL_DISABLED environment variable is set/).className).toContain("text-xs");
    expect(screen.queryByRole("button", { name: /Send to/ })).toBeNull();
  });

  it("says how many batches the New leads need, and offers the next batch, with its own preview, when one finishes", async () => {
    const ids = (from: number, n: number) => Array.from({ length: n }, (_, i) => `l${from + i}`);
    const batch = (first: number, totalEligible: number): BulkPreview => ({
      ...PREVIEW,
      totalEligible,
      leadIds: ids(first, Math.min(50, totalEligible)),
      willSend: Math.min(50, totalEligible),
      distinctAddresses: Math.min(50, totalEligible),
    });
    outreach.previewBulkSendAction
      .mockResolvedValueOnce({ ok: true, preview: batch(0, 120) })
      .mockResolvedValueOnce({ ok: true, preview: batch(50, 70) });
    outreach.sendBulkChunkAction.mockImplementation(async (_p: string, leadIds: string[]) => chunk(leadIds, { sent: 1 }));
    render(<BulkSendButton pipeline="cold-outreach" />);

    fireEvent.click(screen.getByRole("button", { name: "Send outreach to new leads…" }));
    expect((await screen.findByText(/^120 New leads have an email/)).textContent).toMatch(/3 batches of up to 50\. This is the first/);
    fireEvent.click(screen.getByRole("button", { name: "Send to 50 leads" }));
    expect((await screen.findByText(/^Sent 50 of 50\./)).textContent).toContain("70 more New leads left: 2 more batches of up to 50.");
    expect(outreach.sendBulkChunkAction).toHaveBeenCalledTimes(50);

    // The next batch is previewed and confirmed like the first; nothing is sent until then.
    fireEvent.click(screen.getByRole("button", { name: "Send the next 50" }));
    expect(await screen.findByRole("button", { name: "Send to 50 leads" })).toBeTruthy();
    expect(screen.getByText(/^70 New leads have an email/).textContent).toMatch(/2 batches of up to 50/);
    expect(outreach.previewBulkSendAction).toHaveBeenCalledTimes(2);
    expect(outreach.sendBulkChunkAction).toHaveBeenCalledTimes(50);
    fireEvent.click(screen.getByRole("button", { name: "Send to 50 leads" }));
    expect((await screen.findByText(/^Sent 50 of 50\./)).textContent).toContain("20 more New leads left: 1 more batch of up to 50.");
    expect(outreach.sendBulkChunkAction.mock.calls[50]![1]).toEqual(ids(50, 50));
    expect(screen.getByRole("button", { name: "Send the next 20" })).toBeTruthy();
  });

  it("doesn't offer the next batch after Stop", async () => {
    outreach.previewBulkSendAction.mockResolvedValue({ ok: true, preview: { ...PREVIEW, totalEligible: 80 } });
    const first = deferred<ReturnType<typeof chunk>>();
    outreach.sendBulkChunkAction.mockReturnValueOnce(first.promise);
    render(<BulkSendButton pipeline="cold-outreach" />);
    fireEvent.click(screen.getByRole("button", { name: "Send outreach to new leads…" }));
    fireEvent.click(await screen.findByRole("button", { name: "Send to 3 leads" }));
    fireEvent.click(await screen.findByRole("button", { name: "Stop sending" }));
    await act(async () => first.resolve(chunk(["a"], { sent: 1 })));
    expect(await screen.findByText(/You stopped the send\./)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Send the next/ })).toBeNull();
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
    fireEvent.click(screen.getByRole("button", { name: "Remove stop@x.test from the list" }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove from list" }));
    expect(await screen.findByText("Removed stop@x.test from the list.")).toBeTruthy();
    expect(settings.removeSuppressionByEmailAction).toHaveBeenCalledWith("stop@x.test");
  });

  it("shows each address whole, with its date and reason, as a list a phone can read", () => {
    const long = {
      email: "accounts.receivable.department@very-long-business-name.example.test",
      since: "Sep 1, 2026",
      why: "Asked by phone",
    };
    render(<DoNotEmailRows rows={[...rows, long]} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[1].textContent).toContain(long.email);
    expect(items[1].textContent).toMatch(/Since Sep 1, 2026/);
    expect(items[1].textContent).toMatch(/Why: Asked by phone/);
    // It may wrap only after the @ or a hyphen, or before a dot, never mid-word.
    expect(items[1].querySelectorAll("wbr")).toHaveLength(8);
  });

  it("says the change couldn't be confirmed when the server can't be reached", async () => {
    settings.removeSuppressionByEmailAction.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<DoNotEmailRows rows={rows} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove stop@x.test from the list" }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove from list" }));
    expect(await screen.findByText(/couldn't confirm whether the list changed/)).toBeTruthy();
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
    reviewReason: null,
    verdict: "positive" as string | null,
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
    // Role queries over the whole list are slow in jsdom under coverage on
    // CI, where the default 1 s wait once ran out before the dialog showed.
    const slow = { timeout: 5_000 };
    // Text queries scoped to buttons: role queries walk the accessibility tree and are the slow part.
    fireEvent.click(await screen.findByText("Attach", { selector: "button" }, slow));
    fireEvent.click(await screen.findByText("Add reply", { selector: "button" }, slow));
    expect(await screen.findByText("Added the reply to Acme Plumbing.", undefined, slow)).toBeTruthy();
    expect(replies.attachReplyAction).toHaveBeenCalledWith("r1", "cold-outreach", "lead-1");
  });

  it("marks an interested reply, and warns before it is dismissed", async () => {
    replies.dismissReplyAction.mockResolvedValue({ ok: true, message: "Dismissed the reply." });
    render(<UnmatchedReplies replies={[{ ...reply, text: "Yes, send me pricing" }]} />);
    expect(screen.getByText(/Someone wrote back keen/).textContent).toMatch(/^Interested\..*moves to Responded\.$/);
    fireEvent.click(screen.getByText("Dismiss", { selector: "button" }));
    expect((await screen.findByText(/It reads as interested/)).textContent).toMatch(/no lead is marked as replied unless you attach it/);
  });

  it("says why a reply needs a look, and can put its address on the do-not-email list", async () => {
    replies.optOutReplyAction.mockResolvedValue({ ok: true, message: "Added assistant@acme.test to the do-not-email list." });
    render(<UnmatchedReplies replies={[{ ...reply, text: "Pls rmv", reviewReason: "It may be asking not to be emailed (“rmv”)." }]} />);
    expect(screen.getByText(/may be asking not to be emailed/).textContent).toMatch(/Nothing is emailed to this address/);
    fireEvent.click(screen.getByRole("button", { name: "Mark opted out" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add to do-not-email list" }));
    expect(await screen.findByText("Added assistant@acme.test to the do-not-email list.")).toBeTruthy();
    expect(replies.optOutReplyAction).toHaveBeenCalledWith("r1");
  });

  it("says a plain no or a thank-you holds the address until it is dismissed", async () => {
    replies.dismissReplyAction.mockResolvedValue({ ok: true, message: "Dismissed the reply." });
    render(<UnmatchedReplies replies={[{ ...reply, text: "Thanks!", verdict: "acknowledged" }]} />);
    expect(screen.getByText(/Only says thanks/).textContent).toMatch(/nothing more is\s+emailed to this address/);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect((await screen.findByRole("dialog")).textContent).toMatch(/can then be emailed again/);
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

describe("The reply-loop check", () => {
  const row = { leadId: "l1", email: "me+c1@x.test", sentAt: "Sep 29, 10:02 AM", status: "Contacted", reply: null };

  it("asks for an address, confirms, and reports the result", async () => {
    settings.startReplyCheckAction.mockResolvedValue({ ok: true, message: "Sent the Cold Outreach pitch to me+c2@x.test." });
    render(<ReplyCheck checks={[]} />);
    fireEvent.click(screen.getByText("Send test pitch", { selector: "button" }));
    expect(await screen.findByText(/Enter an address you can read/)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("you+check1@example.com"), { target: { value: "me+c2@x.test" } });
    fireEvent.click(screen.getByText("Send test pitch", { selector: "button" }));
    expect((await screen.findByRole("dialog")).textContent).toMatch(/creates a Cold Outreach lead called “Reply check”/);
    fireEvent.click(screen.getAllByText("Send test pitch", { selector: "button" })[0]!);
    expect(await screen.findByText("Sent the Cold Outreach pitch to me+c2@x.test.")).toBeTruthy();
    expect(settings.startReplyCheckAction).toHaveBeenCalledWith("me+c2@x.test");
  });

  it("says when the server can't be reached", async () => {
    settings.startReplyCheckAction.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<ReplyCheck checks={[]} />);
    fireEvent.change(screen.getByPlaceholderText("you+check1@example.com"), { target: { value: "me@x.test" } });
    fireEvent.click(screen.getByText("Send test pitch", { selector: "button" }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getAllByText("Send test pitch", { selector: "button" })[0]!);
    expect(await screen.findByText(/Couldn't reach the server/)).toBeTruthy();
  });

  it("describes each state of a check", () => {
    render(
      <ReplyCheck
        checks={[
          { ...row, state: "waiting" },
          { ...row, leadId: "l2", state: "late" },
          { ...row, leadId: "l3", state: "not_sent", sentAt: null },
          { ...row, leadId: "l4", state: "recorded", status: "Lost", reply: { receivedAt: "Sep 29, 10:05 AM", readAs: "an opt-out" } },
        ]}
      />,
    );
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items[0]).toMatch(/Waiting for your reply/);
    expect(items[1]).toMatch(/no reply has been recorded/);
    expect(items[2]).toMatch(/wasn't sent/);
    expect(items[3]).toMatch(/Passed\. .*read as an opt-out\. The lead is now Lost\./);
  });
});
