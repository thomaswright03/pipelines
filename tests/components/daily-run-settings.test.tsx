// @vitest-environment jsdom
// The daily-automation panel as the dataleadsell page shows it: in agents,
// saved through the pipeline's own action, and off until turned on.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import "./dom";

vi.mock("@/lib/actions/pipeline-schedule", () => ({ updateVaultScheduleAction: vi.fn(async () => ({})) }));

const { default: DailyRunSettings } = await import("@/components/DailyRunSettings");

const base = { runTimeLabel: "every hour from 9:03 AM to 4:03 PM Arizona time", paused: false, staleWarning: null };

beforeEach(() => vi.clearAllMocks());

describe("DailyRunSettings for dataleadsell", () => {
  it("says it's off, and talks about agents", () => {
    render(
      <DailyRunSettings
        {...base}
        pipeline="dataleadsell"
        action={vi.fn(async () => ({}))}
        schedule={{ enabled: false, emailsPerDay: 10 }}
        runs={[]}
      />,
    );
    expect(screen.getByText("Off: the daily run is skipped until you turn it back on.")).toBeTruthy();
    expect((screen.getByLabelText("Emails to send per day (1–50)") as HTMLInputElement).value).toBe("10");
    expect(screen.getByRole("checkbox", { name: "Run daily" })).toHaveProperty("checked", false);
    expect(screen.getByText(/Not every agent has a findable email address/)).toBeTruthy();
    // Off, the run time is still said, in words.
    expect(screen.getByText(/runs every hour from 9:03 AM to 4:03 PM Arizona time\./)).toBeTruthy();
  });

  it("describes a run in agents when on, and shows the last run's numbers in agents", () => {
    render(
      <DailyRunSettings
        {...base}
        pipeline="dataleadsell"
        action={vi.fn(async () => ({}))}
        schedule={{ enabled: true, emailsPerDay: 10 }}
        runs={[
          {
            id: "r1",
            status: "succeeded",
            startedAt: "Sep 27",
            summary: "ok",
            errors: [],
            numbers: { businessesChecked: 10, leadsFound: 2, emailsSent: 1 },
          },
        ]}
      />,
    );
    expect(
      screen.getByText(
        /^On: runs every hour from 9:03 AM to 4:03 PM Arizona time\. Each run sends first pitches until 10 have gone out today, searching the next city in the business list for real estate agents/,
      ),
    ).toBeTruthy();
    const line = screen.getByText(/Last run \(Sep 27\)/).closest("p")!;
    expect(line.textContent).toMatch(/checked 10 agents, found 2 addresses, emailed 1 agent\.$/);
  });

  it("checks the number in agents before saving, then saves through the action it was given", async () => {
    const action = vi.fn(async () => ({ saved: true, values: { enabled: true, emailsPerDay: "5" } }));
    render(
      <DailyRunSettings {...base} pipeline="dataleadsell" action={action} schedule={{ enabled: false, emailsPerDay: 10 }} runs={[]} />,
    );
    const count = screen.getByLabelText("Emails to send per day (1–50)");
    // The fixed run time is a sentence, not something that looks like a form field.
    expect(screen.getByText(/^When it's on, it runs every hour from 9:03 AM to 4:03 PM Arizona time\. Those times are fixed/)).toBeTruthy();
    expect(count.closest("form")!.textContent).not.toMatch(/Arizona time|Time/);

    fireEvent.change(count, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Emails to send per day must be a whole number between 1 and 50")).toBeTruthy();
    expect(action).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("checkbox", { name: "Run daily" }));
    fireEvent.change(count, { target: { value: "5" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save" })));
    expect(await screen.findByText("Saved — the next daily run uses these settings.")).toBeTruthy();
    expect(action).toHaveBeenCalledTimes(1);
    const form = (action.mock.calls[0] as unknown as [unknown, FormData])[1];
    expect(form.get("enabled")).toBe("on");
    expect(form.get("emailsPerDay")).toBe("5");
  });
});
