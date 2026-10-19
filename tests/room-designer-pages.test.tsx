// @vitest-environment jsdom
// The Room Designer 3D pages render with representative data, with sending held.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { makeRemodelerLead } from "./helpers";
import { pageProps, renderPage } from "./render-page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/room-designer",
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
const { default: List } = await import("@/app/room-designer/page");
const { default: Remodeler } = await import("@/app/room-designer/[id]/page");
const { default: Edit } = await import("@/app/room-designer/[id]/edit/page");
const { default: New } = await import("@/app/room-designer/new/page");
const { default: Stats } = await import("@/app/room-designer/stats/page");
const { default: Deck } = await import("@/app/room-designer/cold-call/page");
const { default: Inbox } = await import("@/app/room-designer/inbox/page");

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the Room Designer 3D pages", () => {
  it("show a card on the dashboard", async () => {
    await makeRemodelerLead();
    const page = await renderPage(Dashboard());
    expect(page.getAllByText("Room Designer 3D").length).toBeGreaterThan(0);
  });

  it("list remodelers with their Yelp categories, and say sending is held", async () => {
    await makeRemodelerLead({ name: "Desert Bath Remodel", services: "Contractors, Kitchen & Bath" });
    const page = await renderPage(List(pageProps()));
    expect(page.getByRole("heading", { name: "Room Designer 3D", level: 1 })).toBeTruthy();
    expect(page.getAllByText("Contractors, Kitchen & Bath").length).toBeGreaterThan(0);
    expect(page.getByRole("button", { name: "Find remodelers in the next city" })).toBeTruthy();
    expect(page.text).toContain("Room Designer 3D sending is off until Thomas turns it on.");
  });

  it("show a remodeler with the pitch preview, and the other pages render", async () => {
    const lead = await makeRemodelerLead({ name: "Desert Bath Remodel" });
    const page = await renderPage(Remodeler(pageProps({ id: lead.id })));
    expect(page.getByRole("heading", { name: "Desert Bath Remodel", level: 1 })).toBeTruthy();
    expect(page.text).toContain("show your customers their new bathroom in 3D");
    await expect(renderPage(Remodeler(pageProps({ id: "missing" })))).rejects.toThrow("NEXT_NOT_FOUND");

    expect((await renderPage(Edit(pageProps({ id: lead.id })))).text).toContain("Edit Desert Bath Remodel");
    expect((await renderPage(New())).text).toContain("Add remodeler");
    expect((await renderPage(Stats())).text).toContain("Room Designer 3D — Stats");
    expect((await renderPage(Deck(pageProps()))).text).toContain("Room Designer 3D");
    expect((await renderPage(Inbox(pageProps()))).text).toContain("Room Designer 3D");
  });
});
