// @vitest-environment jsdom
// The Inbox's Reply box: opens, sends, shows the outcome, and says so when
// the server can't be reached.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { deferred } from "./dom";

const router = { refresh: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const actions = vi.hoisted(() => ({ sendInboxReplyAction: vi.fn() }));
vi.mock("@/lib/actions/outreach", () => actions);

const { default: InboxReplyForm } = await import("@/components/InboxReplyForm");

beforeEach(() => vi.clearAllMocks());

function open() {
  render(<InboxReplyForm pipeline="cold-outreach" replyId="r1" to="a@b.test" subject="Re: Hi" />);
  fireEvent.click(screen.getByRole("button", { name: "Reply" }));
  fireEvent.change(screen.getByLabelText("Your reply to a@b.test"), { target: { value: "Thanks, talk soon" } });
}

describe("InboxReplyForm", () => {
  it("sends the reply, shows it's sending, then reports the result and closes", async () => {
    const pending = deferred<{ ok: true; message: string }>();
    actions.sendInboxReplyAction.mockReturnValue(pending.promise);
    open();
    expect(screen.getByText("To a@b.test · Re: Hi")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    expect(actions.sendInboxReplyAction).toHaveBeenCalledWith("cold-outreach", "r1", "Thanks, talk soon");
    expect((screen.getByRole("button", { name: "Sending…" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => pending.resolve({ ok: true, message: "Sent your reply to a@b.test." }));
    expect(screen.getByText("Sent your reply to a@b.test.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reply" })).toBeTruthy();
    expect(router.refresh).toHaveBeenCalled();
  });

  it("keeps the text and shows the reason when the send is refused", async () => {
    actions.sendInboxReplyAction.mockResolvedValue({ ok: false, error: "Outbound email is paused (see Settings) — nothing was sent." });
    open();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send reply" })));
    expect(screen.getByText(/Outbound email is paused/)).toBeTruthy();
    expect((screen.getByLabelText("Your reply to a@b.test") as HTMLTextAreaElement).value).toBe("Thanks, talk soon");
  });

  it("warns the reply may not have gone out when the server can't be reached", async () => {
    actions.sendInboxReplyAction.mockRejectedValue(new TypeError("Failed to fetch"));
    open();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send reply" })));
    expect(screen.getByText(/may not have been sent/)).toBeTruthy();
  });

  it("closes without sending on Cancel, and shows why when replying isn't allowed", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(actions.sendInboxReplyAction).not.toHaveBeenCalled();
    render(<InboxReplyForm pipeline="cold-outreach" replyId="r2" to="x@y.test" subject="Re: Hi" disabledReason="Opted out." />);
    expect(screen.getByText("Opted out.")).toBeTruthy();
  });
});
