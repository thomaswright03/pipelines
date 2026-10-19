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
import { makeAgentLead, makeColdLead, makeHaulerLead } from "./helpers";
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
const { default: HaulerList } = await import("@/app/garbage-ai/page");
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
const { default: VaultInbox } = await import("@/app/vault-pipeline/inbox/page");
const { default: AgentInbox } = await import("@/app/dataleadsell/inbox/page");
const { default: Replies } = await import("@/app/replies/page");
const { default: Inbox } = await import("@/app/inbox/page");
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
    expect(page.getByRole("heading", { name: "Cold email outreach" })).toBeTruthy();
    expect(page.text).toContain("Finds leads, emails each address one pitch, tracks the replies");
    expect(page.queryByRole("heading", { name: "Runs elsewhere" })).toBeNull();
    expect(page.queryByText("AI Lead Responder")).toBeNull();
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
    expect(page.queryByRole("alert")).toBeNull();
  });

  it("warns at the top when no reply has come back 48 hours after a send", async () => {
    await prisma.outreachRecipient.create({
      data: { pipeline: "cold-outreach", email: "a@x.test", state: "sent", sentAt: new Date(Date.now() - 3 * 86_400_000) },
    });
    const page = await renderPage(Dashboard());
    const alert = page.getByRole("alert");
    expect(alert.textContent).toMatch(/Replies don.t seem to be reaching the app/);
    expect(alert.textContent).toMatch(/Opt-outs sent meanwhile are not being recorded/);
    expect(alert.textContent).toMatch(/Mark opted out/);
  });
});

describe("the root layout", () => {
  it("wraps a page with the nav, the test-mode pill and the paused pill", async () => {
    await setOutboundPaused(true);
    const page = await renderPage(RootLayout({ children: <p>Page body</p>, params: Promise.resolve({}) } as never));
    expect(page.getByText("Page body")).toBeTruthy();
    expect(page.getByRole("link", { name: /Outbound email paused/ })).toBeTruthy();
    expect(page.getByText("Sending paused")).toBeTruthy();
    expect(page.getByRole("link", { name: "Operator guide" })).toBeTruthy();
    expect(page.getByText("Skip to content")).toBeTruthy();
    expect(page.queryByText("Replies not arriving")).toBeNull();
  });

  it("says when sending is switched off by the hosting, even with the Settings switch on", async () => {
    vi.stubEnv("OUTBOUND_EMAIL_DISABLED", "1");
    const page = await renderPage(RootLayout({ children: <p>Page body</p>, params: Promise.resolve({}) } as never));
    expect(page.getByRole("link", { name: "Outbound email switched off by your hosting" })).toBeTruthy();
    expect(page.text).not.toContain("OUTBOUND_EMAIL_DISABLED");
    expect(page.getByText("Sending off (server)")).toBeTruthy();
  });

  it("warns in the header when replies have stopped arriving", async () => {
    await prisma.outreachRecipient.create({
      data: { pipeline: "cold-outreach", email: "a@x.test", state: "sent", sentAt: new Date(Date.now() - 3 * 86_400_000) },
    });
    const page = await renderPage(RootLayout({ children: <p>Page body</p>, params: Promise.resolve({}) } as never));
    expect(page.getByRole("link", { name: /Replies not arriving/ }).getAttribute("href")).toBe("/replies");
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
      expect(page.text).toMatch(/yet — search for some with the tools below the list, or add one by hand\./);
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

describe("copy about the pipelines", () => {
  it("never says there are two: settings, lists and dialogs cover every pipeline", async () => {
    const { readdir, readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const root = path.resolve(__dirname, "../src");
    const files = (await readdir(root, { recursive: true })).filter((f) => /\.(ts|tsx)$/.test(f) && !f.startsWith("generated"));
    const twoPipelines = /\b(both|neither|either) pipelines?\b|\btwo pipelines\b/i;
    const offenders: string[] = [];
    for (const file of files) if (twoPipelines.test(await readFile(path.join(root, file), "utf8"))) offenders.push(file);
    expect(offenders).toEqual([]);
  });
});

describe("the ready-to-email count", () => {
  it("matches what a bulk send will email, and says how many it will skip", async () => {
    await makeAgentLead({ name: "Ann", email: "shared@team.test" });
    await makeAgentLead({ name: "Bea", email: "shared@team.test" });
    await makeAgentLead({ name: "Cal", email: "pitched@agent.test" });
    await makeAgentLead({ name: "Dee", email: "dee@agent.test" });
    await prisma.outreachRecipient.create({ data: { pipeline: "dataleadsell", email: "pitched@agent.test", state: "sent" } });

    const { previewBulkSend } = await import("@/lib/outreach/send");
    expect(await previewBulkSend("dataleadsell")).toMatchObject({ willSend: 2, totalEligible: 4 });
    const page = await renderPage(AgentList(pageProps()));
    expect(page.text).toContain("2 agents ready to email.");
    expect(page.text).toContain("2 other New agents with an address will be skipped");
    const dashboard = await renderPage(Dashboard());
    expect(dashboard.getAllByText("Ready to email")[0]!.parentElement?.textContent).toMatch(/2/);
  });
});

describe("a lead page", () => {
  it("offers the send for a New lead, with the pitch preview and its template version", async () => {
    const lead = await makeColdLead({ name: "Pat Owner", company: "Bob's Bakery" });
    const page = await renderPage(VaultLead(pageProps({ id: lead.id })));
    expect(page.getByRole("heading", { name: "Pat Owner" })).toBeTruthy();
    expect(page.getByRole("button", { name: "Send outreach email" })).toBeTruthy();
    expect(page.text).toContain("Email version 1 (the current wording, not sent yet)");
    expect(page.text).not.toContain(COLD_OUTREACH_TEMPLATE_VERSION); // no internal fingerprint on screen
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
    expect(page.text).toMatch(/Email version 1 \(an earlier wording, first sent \w{3} \d{1,2}, \d{4}\)/);
    expect(page.text).not.toContain("old-v1");
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

describe("the three pipeline pages", () => {
  it("share one layout: the same summary tiles, then the same sections in the same order", async () => {
    await makeColdLead({ email: null });
    await makeColdLead();
    await makeAgentLead();
    await makeHaulerLead({ email: null });
    const shapes = [];
    for (const [List, noun, total, withEmail] of [
      [VaultList, "leads", "2", "1"],
      [AgentList, "agents", "1", "1"],
      [HaulerList, "haulers", "1", "0"],
    ] as const) {
      const page = await renderPage(List(pageProps()));
      const tools = page.body.querySelector("section#tools")!;
      expect(tools.querySelector("h2")!.textContent).toBe(`Find and email ${noun === "leads" ? "businesses" : noun}`);
      const tiles = [...tools.querySelectorAll(".grid > .card")].map((c) => c.textContent);
      expect(tiles).toEqual([`${total}Total ${noun}`, `${withEmail}With email`]);
      // The order of the tools' headings, with each pipeline's own words taken out.
      shapes.push(
        [...tools.querySelectorAll("h2, h3")]
          .map((h) => h.textContent!.replace(/agents|haulers|businesses|leads/g, "…"))
          .filter((h) => !/ADRE/.test(h)),
      );
    }
    expect(shapes[0]).toEqual(["Find and email …", "Send outreach to new …", "Daily automation", "Recent runs"]);
    expect(shapes[1]).toEqual(shapes[0]);
    expect(shapes[2]).toEqual(shapes[0]);
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
    const replies = await renderPage(Replies());
    expect(replies.getByRole("heading", { level: 1, name: "Unmatched replies" })).toBeTruthy();
    // It says what lives where, and links to each pipeline's own replies.
    expect(replies.text).toContain("Only replies from an address that isn't on any lead wait here.");
    expect(replies.getByRole("link", { name: "Cold Outreach" }).getAttribute("href")).toBe("/vault-pipeline/inbox?tab=replied");
    expect(replies.getByRole("link", { name: "Garbage AI" }).getAttribute("href")).toBe("/garbage-ai/inbox?tab=replied");
    // Nothing has arrived: no claim about replies "so far".
    expect(replies.text).toContain("No replies have arrived yet.");
    expect(replies.text).not.toContain("every reply so far");
    const settings = await renderPage(Settings(pageProps()));
    expect(settings.getByRole("button", { name: "Pause all outbound email" })).toBeTruthy();
    const help = await renderPage(Help());
    expect(help.text).toMatch(/Operator guide/);
    // All three pipelines, with the Garbage AI rules and its daily run time.
    expect(help.getByRole("heading", { name: "Garbage AI" })).toBeTruthy();
    expect(help.text).toContain("Mountain High Disposal's service area (Denver metro and Northern Colorado)");
    expect(help.text).toContain("Garbage AI every hour from 8:00 AM to 3:00 PM Arizona time");
    expect(help.text).toMatch(/Demo booked \/ Signed up/);
    expect(help.text).not.toMatch(/both pipelines|neither pipeline|either pipeline/i);
    expect((await renderPage(<NotFound />)).getByRole("link", { name: "Back to dashboard" })).toBeTruthy();
    expect(() => Missing()).toThrow("NEXT_NOT_FOUND");
  });

  it("say every reply so far was matched only once replies have arrived and all matched", async () => {
    const lead = await makeColdLead({ email: "pat@shop.test", status: "contacted", lastEmailedAt: new Date() });
    await prisma.inboundReply.create({
      data: {
        dedupeKey: "mid:1",
        fromEmail: "pat@shop.test",
        text: "Yes, call me",
        optedOut: false,
        matched: [`cold-outreach:${lead.id}`],
      },
    });
    const page = await renderPage(Replies());
    expect(page.text).toContain("Nothing to do here: every reply so far came from a lead's own address");
    expect(page.text).not.toContain("No replies have arrived yet.");
  });

  it("show interested replies from unknown addresses first, labelled and counted", async () => {
    const reply = (fromEmail: string, text: string, verdict: string, extra = {}) =>
      prisma.inboundReply.create({
        data: { dedupeKey: `mid:${fromEmail}`, fromEmail, text, optedOut: false, matched: [], verdict, ...extra },
      });
    await reply("boss@fan.test", "Forwarded — my boss is interested, call 480-555-0000", "positive");
    await reply("noise@else.test", "Pls rmv", "needs_look", { reviewReason: "It may be asking not to be emailed (“rmv”)." });

    const page = await renderPage(Replies());
    expect(page.text).toContain("Match each reply below to the lead it belongs to, or dismiss it.");
    expect(page.text).toContain("1 interested, listed first; 1 other.");
    const items = page.getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(items[0]).toMatch(/^boss@fan\.test.*Interested\. Someone wrote back keen/);
    expect(items[1]).toMatch(/^noise@else\.test.*Needs a look\./);

    const layout = await renderPage(RootLayout({ children: <p>Inside</p>, params: Promise.resolve({}) } as never));
    const repliesLink = layout.getAllByRole("link").find((link) => link.getAttribute("href") === "/replies");
    expect(repliesLink?.textContent).toBe("Unmatched replies2 waiting to be matched, 1 interested");
    const pipeline = await renderPage(AgentList(pageProps()));
    expect(pipeline.text).toContain("2 replies came from an address that isn't on any lead — 1 read as interested.");
  });

  it("list every inbound message on Inbox, automatic and unmatched ones included, with filters", async () => {
    const lead = await makeColdLead({ email: "pat@shop.test", status: "contacted", lastEmailedAt: new Date() });
    const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);
    await prisma.inboundReply.create({
      data: {
        dedupeKey: "mid:a",
        fromEmail: "pat@shop.test",
        subject: "Re: hi",
        text: "Yes, call me",
        optedOut: false,
        matched: [`cold-outreach:${lead.id}`],
        verdict: "positive",
        receivedAt: at(3),
      },
    });
    await prisma.inboundReply.create({
      data: {
        dedupeKey: "mid:b",
        fromEmail: "no-reply@mail.instagram.com",
        subject: "123456 is your Instagram code",
        text: "Use 123456 to verify your account.",
        optedOut: false,
        matched: [],
        kind: "auto_reply",
        kindReason: "Auto-Submitted: auto-generated header",
        resolvedAt: new Date(),
        resolution: "auto_reply",
        receivedAt: at(1),
      },
    });

    const page = await renderPage(Inbox(pageProps()));
    expect(page.text).toContain("thomas@wright-ai-solutions.com");
    expect(page.text).toContain("All (2)");
    const items = page.getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(items[0]).toMatch(
      /^no-reply@mail\.instagram\.comNot on any lead.*Automatic.*123456 is your Instagram code.*Use 123456 to verify/,
    );
    expect(items[1]).toMatch(/^pat@shop\.testCold Outreach lead.*Interested.*Yes, call me/);
    expect(page.getByRole("link", { name: "Cold Outreach lead" }).getAttribute("href")).toBe(`/vault-pipeline/${lead.id}`);

    const people = await renderPage(Inbox(pageProps({}, { filter: "people" })));
    expect(people.getAllByRole("listitem")).toHaveLength(1);
    expect(people.text).not.toContain("Instagram");

    const replies = await renderPage(Replies());
    expect(replies.getByRole("link", { name: "Inbox" }).getAttribute("href")).toBe("/inbox");
  });

  it("show the reply-loop check on Settings, with what came back", async () => {
    const lead = await makeColdLead({
      name: "Reply check",
      email: "owner+c1@example.test",
      source: "Reply check (Settings)",
      status: "responded",
      lastEmailedAt: new Date(),
    });
    await prisma.inboundReply.create({
      data: {
        dedupeKey: "mid:check",
        fromEmail: "owner+c1@example.test",
        optedOut: false,
        matched: [`cold-outreach:${lead.id}`],
        verdict: "positive",
      },
    });
    const settings = await renderPage(Settings(pageProps()));
    expect(settings.getByRole("button", { name: "Send test pitch" })).toBeTruthy();
    const check = settings.getByRole("list", { name: "Recent reply-loop checks" }).textContent ?? "";
    expect(check).toMatch(/Passed\. Pitch sent .*; your reply was recorded .*, read as interested\. The lead is now Responded\./);
  });

  it("show Settings with outbound email paused", async () => {
    await setOutboundPaused(true);
    const settings = await renderPage(Settings(pageProps()));
    expect(settings.getByRole("heading", { name: "Outbound email: paused" })).toBeTruthy();
  });

  it("show Settings with outbound email switched off by the hosting: plain words first, the setting in a developer line", async () => {
    vi.stubEnv("OUTBOUND_EMAIL_DISABLED", "1");
    const settings = await renderPage(Settings(pageProps()));
    expect(settings.getByRole("heading", { name: "Outbound email: switched off by your hosting" })).toBeTruthy();
    const notice = settings.getByText(/^Switched off outside this app\./).closest("div")!;
    const [lead, detail] = [...notice.querySelectorAll("p")].map((p) => p.textContent ?? "");
    expect(lead).toMatch(
      /^Switched off outside this app\. Sending is switched off by whoever manages the app's hosting \(usually your developer\)/,
    );
    expect(lead).toContain("Ask them to turn it back on");
    expect(lead).not.toMatch(/OUTBOUND_EMAIL_DISABLED|redeploy|hosting environment/);
    expect(detail).toMatch(/^For your developer: the OUTBOUND_EMAIL_DISABLED environment variable is set\./);
    // Not paused here, so the emergency-stop line shows too: no variable name in it either.
    vi.unstubAllEnvs();
    const on = await renderPage(Settings(pageProps()));
    expect(on.text).toContain("sending can also be stopped from the hosting dashboard — the operator guide's Emergency stop says how.");
    expect(on.text).not.toContain("OUTBOUND_EMAIL_DISABLED");
  });

  it("tell the operator on a lead page which stop is on, and where it can be undone", async () => {
    const lead = await makeColdLead();
    await setOutboundPaused(true);
    const paused = await renderPage(VaultLead(pageProps({ id: lead.id })));
    expect(paused.text).toContain("Outbound email is paused — resume it in Settings to send.");

    vi.stubEnv("OUTBOUND_EMAIL_DISABLED", "1");
    const off = await renderPage(VaultLead(pageProps({ id: lead.id })));
    expect(off.text).toContain(
      "Sending is switched off by whoever manages the app's hosting (usually your developer), so nothing is emailed from any pipeline. Ask them to turn it back on",
    );
    expect(off.getByText(/^For your developer: the OUTBOUND_EMAIL_DISABLED/).className).toContain("text-xs");
    expect(off.text).not.toContain("resume it in Settings");
  });
});

describe("the inbox pages", () => {
  it("show each folder with its count and link sends to their lead", async () => {
    const lead = await makeColdLead({ name: "Acme Plumbing" });
    await prisma.leadEmailSendLog.create({ data: { leadId: lead.id, email: lead.email!, subject: "Quick question" } });
    await prisma.outreachRecipient.create({
      data: { pipeline: "cold-outreach", email: "gone@x.test", state: "refused", lastError: "550 no such user" },
    });
    const page = await renderPage(VaultInbox(pageProps()));
    expect(page.getByRole("heading", { level: 1, name: "Cold Outreach — Sent & replies" })).toBeTruthy();
    expect(page.getByRole("link", { name: "Unmatched replies" }).getAttribute("href")).toBe("/replies");
    expect(page.getByRole("link", { name: "Sent (1)" }).getAttribute("href")).toBe("/vault-pipeline/inbox?tab=sent");
    expect(page.getByRole("link", { name: "Failed (1)" })).toBeTruthy();
    expect(page.getByRole("link", { name: "Replied (0)" })).toBeTruthy();
    expect(page.getByRole("link", { name: "Acme Plumbing" }).getAttribute("href")).toBe(`/vault-pipeline/${lead.id}`);
    expect(page.text).toContain("Quick question");

    const failed = await renderPage(VaultInbox(pageProps({}, { tab: "failed" })));
    expect(failed.text).toContain("Refused by mail server");
    expect(failed.text).toContain("550 no such user");
  });

  it("show replies with how each was read", async () => {
    const lead = await makeAgentLead({ name: "Jane Agent", repliedAt: new Date() });
    await prisma.inboundReply.create({
      data: {
        dedupeKey: "mid:1",
        fromEmail: lead.email!,
        text: "Sounds good, call me",
        optedOut: false,
        matched: [`dataleadsell:${lead.id}`],
        verdict: "positive",
      },
    });
    const page = await renderPage(AgentInbox(pageProps({}, { tab: "replied" })));
    expect(page.getByText("Interested")).toBeTruthy();
    expect(page.text).toContain("Sounds good, call me");
    expect(page.getByRole("link", { name: "Jane Agent" }).getAttribute("href")).toBe(`/dataleadsell/${lead.id}`);
    expect(page.getByRole("button", { name: "Reply" })).toBeTruthy();
    expect(page.getByRole("link", { name: /Open in Gmail/ }).getAttribute("href")).toBe(
      "https://mail.google.com/mail/u/0/#search/rfc822msgid%3A1",
    );
  });
});
