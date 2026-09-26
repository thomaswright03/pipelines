// @vitest-environment jsdom
// Round-10 finding 8: a lead form never cuts text silently. Over-long text
// stays in the field with a live count and the field's "at most" error, and
// is not saved; long notes show a count as they near the limit.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "./dom";

const router = { refresh: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const vault = vi.hoisted(() => ({ createLeadAction: vi.fn(), updateLeadAction: vi.fn() }));
vi.mock("@/lib/actions/vault-pipeline", () => vault);
vi.mock("@/lib/actions/dataleadsell", () => ({ createAgentAction: vi.fn(), updateAgentAction: vi.fn() }));

const { ColdOutreachLeadForm, EMPTY_COLD_OUTREACH_LEAD } = await import("@/components/LeadForms");

beforeEach(() => vi.clearAllMocks());

function renderForm() {
  render(<ColdOutreachLeadForm mode={{ kind: "create" }} initial={EMPTY_COLD_OUTREACH_LEAD} />);
  return { name: screen.getByLabelText(/^Name/) as HTMLInputElement, notes: screen.getByLabelText("Notes") as HTMLTextAreaElement };
}

describe("text past a field's limit", () => {
  it("is kept whole, counted, refused with the field's error, and never saved", () => {
    const { name } = renderForm();
    expect(name.maxLength).toBe(-1); // no native cap that would cut a paste
    const long = "Sunrise Family Plumbing ".repeat(6).trim(); // 143 characters
    fireEvent.change(name, { target: { value: long } });
    expect(name.value).toBe(long);
    expect(screen.getByText("143 / 120 characters — 23 over the limit")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Save|Add/ }));
    expect(screen.getByText("Name can be at most 120 characters")).toBeTruthy();
    expect(vault.createLeadAction).not.toHaveBeenCalled();
    expect(name.getAttribute("aria-describedby")).toContain("field-name-count");
  });

  it("shows no count until the text nears the limit", () => {
    const { name, notes } = renderForm();
    fireEvent.change(name, { target: { value: "Bob's Bakery" } });
    expect(screen.queryByText(/ \/ 120 characters/)).toBeNull();

    fireEvent.change(notes, { target: { value: "x".repeat(4_100) } });
    expect(screen.getByText("4,100 / 5,000 characters")).toBeTruthy();
  });
});
