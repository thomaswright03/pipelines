// @vitest-environment jsdom
// The dataleadsell page's daily automation: off by default, its runs (not
// Cold Outreach's) listed, a stale-run warning only while it is on, and
// the "ready to email" line telling daily-run agents apart once it is on.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { prisma } from "@/lib/db";
import { savePipelineSchedule, DATALEADSELL_SCHEDULE_ID } from "@/lib/pipeline-schedule";
import { DAILY_RUN_SOURCE } from "@/lib/vault-daily-run";
import { makeAgentLead } from "./helpers";
import { pageProps, renderPage } from "./render-page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/dataleadsell",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/form", () => ({ default: ({ children }: { children: ReactNode }) => <form>{children}</form> }));

const { default: AgentList } = await import("@/app/dataleadsell/page");

const TWO_DAYS_AGO = new Date(Date.now() - 2 * 86_400_000);

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the dataleadsell page's daily automation", () => {
  it("is off by default, at 9:03 AM, and shows no runs yet", async () => {
    // A Cold Outreach run doesn't show here.
    await prisma.pipelineRun.create({ data: { pipeline: "cold-outreach", kind: "daily", status: "succeeded", summary: "Cold run" } });
    const page = await renderPage(AgentList(pageProps()));
    expect(page.getByRole("heading", { name: "Daily automation" })).toBeTruthy();
    expect(page.text).toContain("Off: the daily run is skipped until you turn it back on.");
    expect(page.text).toContain("9:03 AM Arizona time");
    expect((page.getByLabelText("Agents to check per run (1–50)") as HTMLInputElement).value).toBe("10");
    expect(page.text).toContain("No daily run has happened yet");
    expect(page.text).not.toContain("Cold run");
  });

  it("while off, says agents are only emailed by Send outreach, and never warns about a stale run", async () => {
    await makeAgentLead({ source: DAILY_RUN_SOURCE });
    await prisma.pipelineRun.create({ data: { pipeline: "dataleadsell", kind: "daily", status: "skipped", startedAt: TWO_DAYS_AGO } });
    const page = await renderPage(AgentList(pageProps()));
    expect(page.text).toMatch(/They.re only emailed when you press Send outreach to new agents\./);
    expect(page.text).not.toMatch(/more than a day ago/);
  });

  it("when on, lists its runs, tells daily-run agents apart, and warns when the last run is over a day old", async () => {
    await savePipelineSchedule(DATALEADSELL_SCHEDULE_ID, { enabled: true, businessesPerRun: 10 });
    await makeAgentLead({ source: DAILY_RUN_SOURCE });
    await makeAgentLead({ source: "Manual entry" });
    await prisma.pipelineRun.create({
      data: {
        pipeline: "dataleadsell",
        kind: "daily",
        status: "succeeded",
        startedAt: TWO_DAYS_AGO,
        summary: "Searched Provo (Utah County, UT): Yelp listed 20 agents, checked 10 for an email, found 1 new address, emailed 1.",
        businessesChecked: 10,
        leadsFound: 1,
        emailsSent: 1,
      },
    });
    const page = await renderPage(AgentList(pageProps()));
    expect(page.text).toMatch(/On: runs every day at 9:03 AM Arizona time\. It searches the next city on Yelp for real estate agents/);
    expect(page.text).toMatch(/checked 10 agents, found 1 address, emailed 1 agent\./);
    expect(page.text).toContain("Searched Provo (Utah County, UT)");
    expect(page.text).toMatch(/The next daily run will email the 1 it found; the other 1/);
    expect(page.text).toMatch(/The last daily run was .+ — more than a day ago/);
  });
});
