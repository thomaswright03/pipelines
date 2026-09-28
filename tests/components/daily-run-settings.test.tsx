// @vitest-environment jsdom
// The daily-automation panel as the dataleadsell page shows it: in agents,
// saved through the pipeline's own action, and off until turned on.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import "./dom";

vi.mock("@/lib/actions/pipeline-schedule", () => ({ updateVaultScheduleAction: vi.fn(async () => ({})) }));

const { default: DailyRunSettings } = await import("@/components/DailyRunSettings");

const base = { runTimeLabel: "9:03 AM Arizona time", paused: false, staleWarning: null };

beforeEach(() => vi.clearAllMocks());

describe("DailyRunSettings for dataleadsell", () => {
  it("says it's off, and talks about agents", () => {
    render(
      <DailyRunSettings
        {...base}
        pipeline="dataleadsell"
        action={vi.fn(async () => ({}))}
        schedule={{ enabled: false, businessesPerRun: 10 }}
        runs={[]}
      />,
    );
    expect(screen.getByText("Off: the daily run is skipped until you turn it back on.")).toBeTruthy();
    expect((screen.getByLabelText("Agents to check per run (1–50)") as HTMLInputElement).value).toBe("10");
    expect(screen.getByRole("checkbox", { name: "Run daily" })).toHaveProperty("checked", false);
    expect(screen.getByText(/Not every agent has a findable email address/)).toBeTruthy();
    expect(screen.getByText("9:03 AM Arizona time")).toBeTruthy();
  });

  it("describes a run in agents when on, and shows the last run's numbers in agents", () => {
    render(
      <DailyRunSettings
        {...base}
        pipeline="dataleadsell"
        action={vi.fn(async () => ({}))}
        schedule={{ enabled: true, businessesPerRun: 10 }}
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
        /^On: runs every day at 9:03 AM Arizona time\. It searches the next city on Yelp for real estate agents, checks up to 10 of those agents/,
      ),
    ).toBeTruthy();
    const line = screen.getByText(/Last run \(Sep 27\)/).closest("p")!;
    expect(line.textContent).toMatch(/checked 10 agents, found 2 addresses, emailed 1 agent\.$/);
  });

  it("checks the number in agents before saving, then saves through the action it was given", async () => {
    const action = vi.fn(async () => ({ saved: true, values: { enabled: true, businessesPerRun: "5" } }));
    render(
      <DailyRunSettings {...base} pipeline="dataleadsell" action={action} schedule={{ enabled: false, businessesPerRun: 10 }} runs={[]} />,
    );
    const count = screen.getByLabelText("Agents to check per run (1–50)");

    fireEvent.change(count, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Agents to check per run must be a whole number between 1 and 50")).toBeTruthy();
    expect(action).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("checkbox", { name: "Run daily" }));
    fireEvent.change(count, { target: { value: "5" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save" })));
    expect(await screen.findByText("Saved — the next daily run uses these settings.")).toBeTruthy();
    expect(action).toHaveBeenCalledTimes(1);
    const form = (action.mock.calls[0] as unknown as [unknown, FormData])[1];
    expect(form.get("enabled")).toBe("on");
    expect(form.get("businessesPerRun")).toBe("5");
  });
});
