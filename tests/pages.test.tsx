// @vitest-environment jsdom
// Every page renders with representative data — empty, normal, a flagged
// or blocked lead, outbound email paused — and shows what the operator
// needs: the right counts, warnings and buttons. Pages are server
// components; tests/render-page.tsx awaits them and renders their HTML.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { prisma } from "@/lib/db";
import { setOutboundPaused } from "@/lib/outreach/settings";
import { suppressEmail } from "@/lib/email-suppression";
import { COLD_OUTREACH_TEMPLATE_VERSION } from "@/lib/vault-email-template";
import { makeAgentLead, makeColdLead } from "./helpers";
import { pageProps, renderPage } from "./render-page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/form", () => ({ default: ({ children }: { children: ReactNode }) => <form>{children}</form> }));
vi.mock("next/font/google", () => ({ Geist: () => ({ variable: "font-sans" }), Geist_Mono: () => ({ variable: "font-mono" }) }));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), connection: async () => {} }));

const { default: Dashboard } = await import("@/app/page");
const { default: RootLayout } = await import("@/app/layout");
const { default: VaultList } = await import("@/app/vault-pipeline/page");
const { default: AgentList } = await import("@/app/dataleadsell/page");
const { default: VaultLead } = await import("@/app/vault-pipeline/[id]/page");
const { default: AgentLead } = await import("@/app/dataleadsell/[id]/page");
const { default: VaultEdit } = await import("@/app/vault-pipeline/[id]/edit/page");
const { default: AgentEdit } = await import("@/app/dataleadsell/[id]/edit/page");
const { default: VaultNew } = await import("@/app/vault-pipeline/new/page");
const { default: AgentNew } = await import("@/app/dataleadsell/new/page");
const { default: VaultStats } = await import("@/app/vault-pipeline/stats/page");
const { default: AgentStats } = await import("@/app/dataleadsell/stats/page");
const { default: VaultDeck } = await import("@/app/vault-pipeline/cold-call/page");
const { default: AgentDeck } = await import("@/app/dataleadsell/cold-call/page");
const { default: VaultLayout } = await import("@/app/vault-pipeline/layout");
const { default: AgentLayout } = await import("@/app/dataleadsell/layout");
const { default: Replies } = await import("@/app/replies/page");
const { default: Settings } = await import("@/app/settings/page");
const { default: Help } = await import("@/app/help/page");
const { default: NotFound } = await import("@/app/not-found");
const { default: Missing } = await import("@/app/[...missing]/page");

const OLD = new Date(Date.now() - 9 * 86_400_000);

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the dashboard", () => {
  it("says what the tool does, with zeros on a fresh install", async () => {
    const page = await renderPage(Dashboard());
    expect(page.getByRole("heading", { name: "Marketing Pipelines" })).toBeTruthy();
    expect(page.text).toContain("Finds leads, emails each address one pitch, tracks the replies");
    expect(page.getByRole("heading", { name: "Runs elsewhere" })).toBeTruthy();
    expect(page.queryByText(/need a look|needs a look/)).toBeNull();
  });

  it("shows each pipeline's numbers and replies waiting for a look", async () => {
    await makeColdLead(); // ready to email
    await makeColdLead({ status: "contacted", lastEmailedAt: new Date() });
    await makeColdLead({ status: "cold_call_list", replyNeedsReview: true, replyReviewReason: "The reply says no." });
    await makeAgentLead({ status: "responded" });
    const page = await renderPage(Dashboard());
    const links = page.getAllByRole("link").map((a) => [a.getAttribute("href"), a.getAttribute("aria-label")]);
    expect(links).toContainEqual(["/vault-pipeline?status=new", "Ready to email: 1"]);
    expect(links).toContainEqual(["/vault-pipeline?status=contacted", "Waiting on a reply: 1"]);
    expect(links).toContainEqual(["/vault-pipeline/cold-call", "To call: 1"]);
    expect(links).toContainEqual(["/dataleadsell?status=responded", "Replied: 1"]);
    expect(page.getByText(/1 reply needs a look/)).toBeTruthy();
  });
});

describe("the root layout", () => {
  it("wraps a page with the nav, the test-mode pill and the paused pill", async () => {
    await setOutboundPaused(true);
    const page = await renderPage(RootLayout({ children: <p>Page body</p>, params: Promise.resolve({}) } as never));
    expect(page.getByText("Page body")).toBeTruthy();
    expect(page.getByRole("link", { name: /Outbound email paused/ })).toBeTruthy();
    expect(page.getByRole("link", { name: "Operator guide" })).toBeTruthy();
    expect(page.getByText("Skip to content")).toBeTruthy();
  });

  it("shows the outage page instead of the page when the database is down", async () => {
    const health = await import("@/lib/db-health");
    const spy = vi.spyOn(health, "databaseReachable").mockResolvedValue(false);
    try {
      const page = await renderPage(RootLayout({ children: <p>Page body</p>, params: Promise.resolve({}) } as never));
      expect(page.queryByText("Page body")).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("the lead lists", () => {
  it("show a first-run message when empty", async () => {
    for (const page of [await renderPage(VaultList(pageProps())), await renderPage(AgentList(pageProps()))]) {
      expect(page.text).toMatch(/yet — run the pipeline above, or add one by hand\./);
    }
  });

  it("list leads with their markers, and say when sending is paused", async () => {
    await setOutboundPaused(true);
    await makeColdLead({ name: "Flagged Bakery", status: "contacted", replyNeedsReview: true, lastEmailedAt: new Date() });
    await makeColdLead({ name: "Held Back Plumbing", sendBlockedReason: "Opted out — x is on the suppression list." });
    await makeAgentLead({ name: "Jane Agent" });
    const vault = await renderPage(VaultList(pageProps({}, { status: "contacted" })));
    expect(vault.getAllByText("Flagged Bakery").length).toBeGreaterThan(0);
    expect(vault.queryByText("Held Back Plumbing")).toBeNull(); // filtered to Contacted
    expect(vault.text).toMatch(/Outbound email is paused/);
    const agents = await renderPage(AgentList(pageProps()));
    expect(agents.getAllByText("Jane Agent").length).toBeGreaterThan(0);
  });
});

describe("a lead page", () => {
  it("offers the send for a New lead, with the pitch preview and its template version", async () => {
    const lead = await makeColdLead({ name: "Pat Owner", company: "Bob's Bakery" });
    const page = await renderPage(VaultLead(pageProps({ id: lead.id })));
    expect(page.getByRole("heading", { name: "Pat Owner" })).toBeTruthy();
    expect(page.getByRole("button", { name: "Send outreach email" })).toBeTruthy();
    expect(page.text).toContain(`Template ${COLD_OUTREACH_TEMPLATE_VERSION}`);
    expect(page.text).toContain("I came across Bob's Bakery");
    // The actions come before the details in the page (first on a phone).
    const html = page.body.innerHTML;
    expect(html.indexOf("Send outreach email")).toBeLessThan(html.indexOf("Outreach email preview"));
  });

  it("shows a lead's name in a solid colour, so emoji in it keep their own colours", async () => {
    const lead = await makeColdLead({ name: "Zoë’s Café 🍰" });
    const page = await renderPage(VaultLead(pageProps({ id: lead.id })));
    const heading = page.getByRole("heading", { name: "Zoë’s Café 🍰", level: 1 });
    expect(heading.className).toContain("accent-text-solid");
    expect(heading.className).not.toMatch(/\baccent-text\b(?!-)/);
  });

  it("warns about a reply that needs a look and says the lead stays off the call deck", async () => {
    const lead = await makeAgentLead({
      status: "contacted",
      lastEmailedAt: OLD,
      replyNeedsReview: true,
      replyReviewReason: "The reply sounds like a complaint.",
    });
    await prisma.emailSendLog.create({
      data: { leadId: lead.id, email: lead.email!, subject: "Probate leads", templateVersion: "old-v1" },
    });
    await prisma.agentLeadActivity.create({
      data: { leadId: lead.id, type: "email", notes: "Reply received — how did you get my email?" },
    });
    await prisma.inboundReply.create({
      data: {
        dedupeKey: "k1",
        fromEmail: lead.email!,
        kind: "reply",
        optedOut: false,
        text: "How did you get my email?",
        reviewReason: "The reply sounds like a complaint.",
        matched: [`dataleadsell:${lead.id}`],
        rulesVersion: "test",
      },
    });
    const page = await renderPage(AgentLead(pageProps({ id: lead.id })));
    expect(page.text).toContain("Reply needs a look");
    expect(page.text).toContain("How did you get my email?");
    expect(page.text).toContain("The reply sounds like a complaint.");
    expect(page.text).toContain("Until you choose, nothing is emailed to this address and the lead stays in Contacted, off the call deck.");
    expect(page.text).toContain("Template old-v1 (an earlier wording)");
    expect(page.text).toContain("how did you get my email?");
  });

  it("shows an opted-out lead as on the do-not-email list, with no send button", async () => {
    const lead = await makeColdLead({
      email: "stop@shop.test",
      sendBlockedReason: "Opted out — stop@shop.test is on the suppression list.",
    });
    await suppressEmail("stop@shop.test", { reason: "Replied STOP", source: "inbound_reply", evidence: "STOP" });
    const page = await renderPage(VaultLead(pageProps({ id: lead.id })));
    expect(page.text).toContain("On the do-not-email list");
    expect(page.queryByRole("button", { name: "Send outreach email" })).toBeNull();
  });

  it("is a 404 for a lead that doesn't exist", async () => {
    await expect(VaultLead(pageProps({ id: "gone" }))).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(AgentLead(pageProps({ id: "gone" }))).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(VaultEdit(pageProps({ id: "gone" }))).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(AgentEdit(pageProps({ id: "gone" }))).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("the add and edit forms", () => {
  it("start empty for a new lead", async () => {
    for (const page of [await renderPage(VaultNew()), await renderPage(AgentNew())]) {
      expect(page.getByRole("heading", { name: /^Add / })).toBeTruthy();
      expect((page.body.querySelector("#field-name") as HTMLInputElement).value).toBe("");
    }
  });

  it("are filled in for an existing lead", async () => {
    const cold = await makeColdLead({ name: "Acme Plumbing", estimatedValueCents: 125_000 });
    const agent = await makeAgentLead({ name: "Jane Doe", brokerage: "HomeSmart" });
    const coldEdit = await renderPage(VaultEdit(pageProps({ id: cold.id })));
    expect(coldEdit.getByRole("heading", { name: "Edit Acme Plumbing" })).toBeTruthy();
    expect((coldEdit.body.querySelector("#field-name") as HTMLInputElement).value).toBe("Acme Plumbing");
    const agentEdit = await renderPage(AgentEdit(pageProps({ id: agent.id })));
    expect(agentEdit.getByRole("heading", { name: "Edit Jane Doe" })).toBeTruthy();
  });
});

describe("the Stats pages", () => {
  it("render with no data", async () => {
    const page = await renderPage(VaultStats());
    expect(page.getByText("Checked, no address found")).toBeTruthy();
    expect(page.getByText("No emails sent yet.")).toBeTruthy();
    expect(page.getAllByText("No leads yet.").length).toBeGreaterThan(0);
  });

  it("separate leads with an address from leads checked without one, and show reply rates by version", async () => {
    const emailed = await makeAgentLead({ status: "responded", repliedAt: new Date() });
    await prisma.emailSendLog.create({
      data: { leadId: emailed.id, email: emailed.email!, subject: "Probate leads", templateVersion: "v-a" },
    });
    await makeAgentLead({ email: null, emailCheckedAt: new Date() });
    const page = await renderPage(AgentStats());
    const card = (label: string) => page.getByText(label, { exact: true }).parentElement!.textContent;
    expect(card("With email")).toMatch(/^1With email/);
    expect(card("Checked, no address found")).toMatch(/^1Checked, no address found/);
    expect(page.text).toContain("“Probate leads”");
    expect(page.text).toContain("1 of 1 agents emailed replied (100%)");
  });
});

describe("the call decks", () => {
  it("say when nobody is on the list", async () => {
    for (const page of [await renderPage(VaultDeck(pageProps())), await renderPage(AgentDeck(pageProps()))]) {
      expect(page.text).toContain("Nobody is on the call list right now.");
    }
  });

  it("show the review warning on a flagged lead's card, and the true size of the list", async () => {
    await makeColdLead({
      name: "Grumpy Owner",
      status: "cold_call_list",
      replyNeedsReview: true,
      replyReviewReason: "The reply sounds like a complaint.",
    });
    await makeColdLead({ name: "Second", status: "cold_call_list" });
    const page = await renderPage(VaultDeck(pageProps()));
    expect(page.getByRole("heading", { name: "Grumpy Owner" })).toBeTruthy();
    expect(page.text).toContain("Reply needs a look before calling.");
    expect(page.text).toContain("Card 1 of 2");
  });
});

describe("the pipeline layouts, Replies, Settings, Help and not-found pages", () => {
  it("render", async () => {
    for (const Layout of [VaultLayout, AgentLayout]) {
      const page = await renderPage(Layout({ children: <p>Inside</p>, params: Promise.resolve({}) } as never));
      expect(page.getByText("Inside")).toBeTruthy();
      expect(page.getByRole("link", { name: "Call deck" })).toBeTruthy();
    }
    expect((await renderPage(Replies())).getByRole("heading", { name: "Replies" })).toBeTruthy();
    const settings = await renderPage(Settings(pageProps()));
    expect(settings.getByRole("button", { name: "Pause all outbound email" })).toBeTruthy();
    expect((await renderPage(Help())).text).toMatch(/Operator guide/);
    expect((await renderPage(<NotFound />)).getByRole("link", { name: "Back to dashboard" })).toBeTruthy();
    expect(() => Missing()).toThrow("NEXT_NOT_FOUND");
  });

  it("show Settings with outbound email paused", async () => {
    await setOutboundPaused(true);
    const settings = await renderPage(Settings(pageProps()));
    expect(settings.getByRole("heading", { name: "Outbound email: paused" })).toBeTruthy();
  });
});
