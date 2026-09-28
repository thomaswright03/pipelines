// @vitest-environment jsdom
// The lead page's email controls: what is offered in each state, the
// confirmation step, and what the operator sees while a send is pending,
// when it succeeds, when the server refuses it, and when the server can't
// be reached.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { deferred } from "./dom";
import type { ActionResult } from "@/lib/outreach/lead-actions";

const router = { refresh: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const actions = vi.hoisted(() => ({
  sendOutreachEmailAction: vi.fn(),
  markOptedOutAction: vi.fn(),
  markRepliedAction: vi.fn(),
  markBouncedAction: vi.fn(),
  removeSuppressionAction: vi.fn(),
  findLeadEmailAction: vi.fn(),
  confirmAddressAction: vi.fn(),
  deleteLeadAction: vi.fn(),
  dismissReplyReviewAction: vi.fn(),
  setOurReplyAction: vi.fn(),
  updateLeadStatusAction: vi.fn(),
}));
vi.mock("@/lib/actions/outreach", () => actions);

const { default: LeadActions } = await import("@/components/LeadActions");
type Lead = Parameters<typeof LeadActions>[0]["lead"];

const NEW_LEAD: Lead = {
  id: "lead-1",
  name: "Acme Plumbing",
  status: "new",
  email: "owner@acme.test",
  sendBlockedReason: null,
  emailed: false,
  bounced: false,
  replied: false,
  ourReplied: false,
  replyNeedsReview: false,
  replyReviewReason: null,
};

function renderLead(
  lead: Partial<Lead> = {},
  props: {
    paused?: boolean;
    suppression?: Parameters<typeof LeadActions>[0]["suppression"];
    latestReply?: Parameters<typeof LeadActions>[0]["latestReply"];
  } = {},
) {
  return render(
    <LeadActions
      pipeline="cold-outreach"
      lead={{ ...NEW_LEAD, ...lead }}
      suppression={props.suppression ?? null}
      paused={props.paused ?? false}
      latestReply={props.latestReply ?? null}
    />,
  );
}

async function sendAndConfirm() {
  fireEvent.click(screen.getByRole("button", { name: "Send outreach email" }));
  fireEvent.click(await screen.findByRole("button", { name: "Send email" }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("LeadActions: sending", () => {
  it("disables sending while outbound email is paused, and says why", () => {
    renderLead({}, { paused: true });
    expect(screen.getByRole("button", { name: "Send outreach email" })).toHaveProperty("disabled", true);
    expect(screen.getByText(/Outbound email is paused/)).toBeTruthy();
  });

  it("asks first, and sends nothing when cancelled", async () => {
    renderLead();
    fireEvent.click(screen.getByRole("button", { name: "Send outreach email" }));
    expect(await screen.findByText("Email Acme Plumbing?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByText("Email Acme Plumbing?")).toBeNull());
    expect(actions.sendOutreachEmailAction).not.toHaveBeenCalled();
  });

  it("disables every control while the send is in flight, then reports success", async () => {
    const pending = deferred<ActionResult>();
    actions.sendOutreachEmailAction.mockReturnValue(pending.promise);
    renderLead();
    await sendAndConfirm();

    await waitFor(() => expect(screen.getByRole("button", { name: "Mark opted out" })).toHaveProperty("disabled", true));
    expect(actions.sendOutreachEmailAction).toHaveBeenCalledWith("cold-outreach", "lead-1");

    await act(async () =>
      pending.resolve({ ok: true, message: "Sent the pitch to Acme Plumbing (owner@acme.test) — moved to Contacted." }),
    );
    expect(await screen.findByText(/Sent the pitch to Acme Plumbing/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mark opted out" })).toHaveProperty("disabled", false);
    expect(router.refresh).toHaveBeenCalled();
  });

  it("shows the server's refusal in its own words", async () => {
    actions.sendOutreachEmailAction.mockResolvedValue({ ok: false, error: "owner@acme.test opted out of our emails — nothing was sent." });
    renderLead();
    await sendAndConfirm();
    const message = await screen.findByText("owner@acme.test opted out of our emails — nothing was sent.");
    expect(message.className).toContain("notice-error");
  });

  it("says the server couldn't be reached when the request itself fails", async () => {
    actions.sendOutreachEmailAction.mockRejectedValue(new TypeError("Failed to fetch"));
    renderLead();
    await sendAndConfirm();
    expect(await screen.findByText(/Couldn't reach the server — nothing was changed/)).toBeTruthy();
  });
});

describe("LeadActions: what is offered", () => {
  it("offers no send for a flagged lead and shows the reason", () => {
    renderLead({ sendBlockedReason: "Address refused by the mail server — owner@acme.test can't receive email." });
    expect(screen.queryByRole("button", { name: "Send outreach email" })).toBeNull();
    expect(screen.getByText(/Address refused by the mail server/)).toBeTruthy();
  });

  it("offers removal from the do-not-email list instead of sending for a suppressed address", () => {
    renderLead({}, { suppression: { source: "inbound_reply", evidence: "Knock it off.", reason: null, since: "Sep 25, 2026" } });
    expect(screen.queryByRole("button", { name: "Send outreach email" })).toBeNull();
    expect(screen.getByText("Knock it off.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove from do-not-email list" })).toBeTruthy();
  });

  it("shows why a reply needs a look, with Mark replied to count it", async () => {
    actions.markRepliedAction.mockResolvedValue({ ok: true, message: "Marked Acme Plumbing as replied." });
    renderLead({ status: "contacted", emailed: true, replyNeedsReview: true, replyReviewReason: "The reply says no thanks." });
    expect(screen.getByText(/The reply says no thanks\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mark replied" }));
    expect(await screen.findByText("Marked Acme Plumbing as replied.")).toBeTruthy();
  });

  it("shows the reply's own words, why it was flagged once, and the choices as buttons", async () => {
    actions.dismissReplyReviewAction.mockResolvedValue({ ok: true, message: "Marked the reply from Acme Plumbing as reviewed." });
    renderLead(
      {
        status: "contacted",
        emailed: true,
        replyNeedsReview: true,
        replyReviewReason: "It may be asking not to be emailed (“exclude”).",
      },
      { latestReply: { text: "Kindly exclude me from future mailings.", receivedAt: "Sep 26, 2026, 9:00 AM", verdict: "needs_look" } },
    );
    const banner = screen.getByRole("region", { name: "Reply needs a look" });
    expect(within(banner).getByText("Kindly exclude me from future mailings.")).toBeTruthy();
    expect(within(banner).getAllByText(/may be asking not to be emailed/)).toHaveLength(1);
    // Each choice appears once on the page: in the banner.
    expect(screen.getAllByRole("button", { name: "Mark replied" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Mark opted out" })).toHaveLength(1);
    expect(within(banner).getByRole("button", { name: "Mark opted out" })).toBeTruthy();

    // Keeping it asks first, since the reply may be an opt-out.
    fireEvent.click(within(banner).getByRole("button", { name: "Keep as Contacted" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toMatch(/doesn.t ask to stop emails/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep as Contacted" }));
    expect(await screen.findByText("Marked the reply from Acme Plumbing as reviewed.")).toBeTruthy();
  });

  it("offers no send while a reply from a New lead needs a look", () => {
    renderLead({ replyNeedsReview: true, replyReviewReason: "It shows no clear yes, question or request." });
    expect(screen.queryByRole("button", { name: "Send outreach email" })).toBeNull();
    expect(screen.getByRole("button", { name: "Keep as New" })).toBeTruthy();
  });

  it("shows a thank-you-only reply, says the address is held, and still offers Mark replied", () => {
    renderLead(
      { status: "contacted", emailed: true },
      { latestReply: { text: "Thanks!", receivedAt: "Sep 26, 2026, 9:00 AM", verdict: "acknowledged" } },
    );
    const note = screen.getByRole("region", { name: "Replied with a thank-you only" });
    expect(within(note).getByText("Thanks!")).toBeTruthy();
    expect(note.textContent).toMatch(/No more email goes to\s+this address/);
    expect(note.textContent).toMatch(/moves to phone outreach after a week/);
    expect(screen.getByRole("button", { name: "Mark replied" })).toBeTruthy();
  });

  it("shows a plain no and how to undo it", () => {
    renderLead(
      { status: "lost", emailed: true },
      { latestReply: { text: "Not interested, thanks.", receivedAt: "Sep 26, 2026, 9:00 AM", verdict: "declined" } },
    );
    const note = screen.getByRole("region", { name: "Replied with a plain no" });
    expect(note.textContent).toMatch(/move the lead back to Responded/);
    expect(screen.queryByRole("region", { name: "Reply needs a look" })).toBeNull();
  });

  it("offers Find email when there is no address", async () => {
    actions.findLeadEmailAction.mockResolvedValue({ ok: false, error: "No address found on acme.test." });
    renderLead({ email: null });
    fireEvent.click(screen.getByRole("button", { name: "Find email" }));
    expect(await screen.findByText("No address found on acme.test.")).toBeTruthy();
  });
});

describe("LeadActions: marking a lead Lost", () => {
  function chooseLost() {
    fireEvent.change(screen.getByRole("combobox", { name: "Move to…" }), { target: { value: "lost" } });
  }

  it("is offered once, and asks why before it confirms", async () => {
    actions.updateLeadStatusAction.mockResolvedValue({ ok: true, message: "Moved Acme Plumbing from Contacted to Lost (Too busy)." });
    renderLead({ status: "contacted", emailed: true });
    expect(screen.getAllByRole("option", { name: "Lost" })).toHaveLength(1);
    chooseLost();
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark lost" }));
    expect(await within(dialog).findByRole("alert")).toHaveProperty("textContent", "Pick one to continue.");
    expect(actions.updateLeadStatusAction).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByRole("combobox", { name: "Why was the lead lost?" }), { target: { value: "too_busy" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark lost" }));
    expect(await screen.findByText("Moved Acme Plumbing from Contacted to Lost (Too busy).")).toBeTruthy();
    expect(actions.updateLeadStatusAction).toHaveBeenCalledWith("cold-outreach", "lead-1", "lost", "too_busy");
  });

  it("changes nothing when cancelled", async () => {
    renderLead({ status: "contacted", emailed: true });
    chooseLost();
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(actions.updateLeadStatusAction).not.toHaveBeenCalled();
  });

  it("asks why on the dataleadsell lead page too", async () => {
    render(
      <LeadActions
        pipeline="dataleadsell"
        lead={{ ...NEW_LEAD, status: "responded", emailed: true, replied: true }}
        suppression={null}
        paused={false}
      />,
    );
    chooseLost();
    expect(within(await screen.findByRole("dialog")).getByRole("combobox", { name: "Why was the lead lost?" })).toBeTruthy();
  });
});

describe("LeadActions: bounces", () => {
  it("offers Mark bounced for an emailed lead", () => {
    renderLead({ status: "contacted", emailed: true });
    expect(screen.getByRole("button", { name: "Mark bounced" })).toBeTruthy();
  });

  it("doesn't offer Mark bounced once a reply opted the lead out (the email arrived)", () => {
    renderLead(
      { status: "lost", emailed: true, replied: true },
      { suppression: { source: "inbound_reply", evidence: "STOP", reason: null, since: "Sep 25, 2026" } },
    );
    expect(screen.queryByRole("button", { name: "Mark bounced" })).toBeNull();
  });
});
