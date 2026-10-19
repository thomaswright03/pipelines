// @vitest-environment jsdom
// The Garbage AI pages render with representative data, with sending on.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { prisma } from "@/lib/db";
import { makeHaulerLead } from "./helpers";
import { pageProps, renderPage } from "./render-page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/garbage-ai",
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
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), connection: async () => {} }));

const { default: Dashboard } = await import("@/app/page");
const { default: List } = await import("@/app/garbage-ai/page");
const { default: Hauler } = await import("@/app/garbage-ai/[id]/page");
const { default: Edit } = await import("@/app/garbage-ai/[id]/edit/page");
const { default: New } = await import("@/app/garbage-ai/new/page");
const { default: Stats } = await import("@/app/garbage-ai/stats/page");
const { default: Deck } = await import("@/app/garbage-ai/cold-call/page");
const { default: Inbox } = await import("@/app/garbage-ai/inbox/page");
const { default: Layout } = await import("@/app/garbage-ai/layout");

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the Garbage AI pages", () => {
  it("show a card on the dashboard", async () => {
    await makeHaulerLead();
    const page = await renderPage(Dashboard());
    expect(page.getAllByText("Garbage AI").length).toBeGreaterThan(0);
    const links = page.getAllByRole("link").map((a) => [a.getAttribute("href"), a.getAttribute("aria-label")]);
    expect(links).toContainEqual(["/garbage-ai?status=new", "Ready to email: 1"]);
  });

  it("list haulers with their Yelp services and a working bulk send", async () => {
    await makeHaulerLead({ name: "Desert Roll Off", services: "Dumpster Rental" });
    const page = await renderPage(List(pageProps()));
    expect(page.getByRole("heading", { name: "Garbage AI", level: 1 })).toBeTruthy();
    expect(page.getAllByText("Desert Roll Off").length).toBeGreaterThan(0);
    expect(page.getAllByText("Dumpster Rental").length).toBeGreaterThan(0);
    expect(page.getByRole("button", { name: "Find haulers in the next city" })).toBeTruthy();
    expect(page.text).not.toMatch(/on hold/);
    for (const button of page.getAllByRole("button", { name: /Send outreach/ })) expect(button.hasAttribute("disabled")).toBe(false);
  });

  it("show a hauler with the pitch preview and a working Send button", async () => {
    const lead = await makeHaulerLead({ name: "Desert Roll Off", services: "Garbage Collection" });
    await prisma.haulerLeadActivity.create({ data: { leadId: lead.id, type: "note", notes: "Owner is Sam." } });
    const page = await renderPage(Hauler(pageProps({ id: lead.id })));
    expect(page.getByRole("heading", { name: "Desert Roll Off", level: 1 })).toBeTruthy();
    expect(page.text).toContain("quick question about your leads");
    expect(page.text).toContain("Garbage Collection");
    expect(page.getByRole("button", { name: "Send outreach email" }).hasAttribute("disabled")).toBe(false);
    await expect(renderPage(Hauler(pageProps({ id: "missing" })))).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("say up front that a hauler in Mountain High's area is never emailed, on its page and in the list", async () => {
    const denver = await makeHaulerLead({ name: "Hauler Co 2", city: "Denver", state: "CO" });
    const escondido = await makeHaulerLead({ name: "Coast Hauling", city: "Escondido", state: "CA" });

    const page = await renderPage(Hauler(pageProps({ id: denver.id })));
    expect(page.queryByRole("button", { name: "Send outreach email" })).toBeNull();
    expect(page.text).toContain("Never emailed: Garbage AI doesn't pitch this hauler (in Mountain High's service area).");

    const other = await renderPage(Hauler(pageProps({ id: escondido.id })));
    expect(other.getByRole("button", { name: "Send outreach email" }).hasAttribute("disabled")).toBe(false);
    expect(other.text).not.toContain("Never emailed");

    const list = await renderPage(List(pageProps()));
    // The list's marker and the ready-to-email count agree: one sendable, one never emailed.
    expect(list.getAllByText("Never emailed: in Mountain High's service area").length).toBeGreaterThan(0);
    expect(list.text).toContain("1 hauler ready to email.");
  });

  it("render the add, edit, stats, call deck, inbox and section nav", async () => {
    const lead = await makeHaulerLead({ name: "Desert Roll Off", status: "cold_call_list", phone: "+14805551001" });
    expect((await renderPage(New())).getByRole("heading", { name: "Add hauler" })).toBeTruthy();
    expect((await renderPage(Edit(pageProps({ id: lead.id })))).getByRole("heading", { name: "Edit Desert Roll Off" })).toBeTruthy();
    expect((await renderPage(Stats())).text).toContain("Demo booked or better");
    expect((await renderPage(Deck(pageProps()))).text).toContain("Desert Roll Off");
    expect((await renderPage(Inbox(pageProps()))).text).toContain("Garbage AI");
    const nav = await renderPage(Layout({ children: <p>body</p>, params: Promise.resolve({}) } as never));
    expect(nav.getByRole("link", { name: "Call deck" }).getAttribute("href")).toBe("/garbage-ai/cold-call");
  });
});
