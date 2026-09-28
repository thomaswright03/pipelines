// Settings → Connections rendering: each tone's badge, the "Not confirmed
// yet" wording, the next step, and a Test connection button only where a
// test exists.
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ConnectionStatus } from "@/lib/integration-status";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/settings", () => ({ testConnectionAction: vi.fn() }));

const { default: ConnectionStatusList } = await import("@/components/ConnectionStatusList");

const items: ConnectionStatus[] = [
  { key: "mail", label: "Sending email", tone: "ok", summary: "Last email sent today.", next: null, testable: true },
  {
    key: "replies",
    label: "Receiving replies",
    tone: "warn",
    badge: "Not confirmed yet",
    summary: "No reply has arrived yet.",
    next: "Mark replies by hand.",
  },
  { key: "daily-run", label: "Daily Cold Outreach run", tone: "error", summary: "Last run failed.", next: "Open the Cold Outreach page." },
  { key: "yelp", label: "Yelp search", tone: "warn", summary: "No search has run yet.", next: "Press Test connection.", testable: true },
];

function rowOf(html: string, key: string): string {
  const start = html.indexOf(`data-connection="${key}"`);
  const end = html.indexOf("</li>", start);
  return html.slice(start, end);
}

describe("ConnectionStatusList", () => {
  const html = renderToStaticMarkup(createElement(ConnectionStatusList, { items }));

  it("labels each tone, with a badge override where given", () => {
    expect(rowOf(html, "mail")).toContain("Working");
    expect(rowOf(html, "replies")).toContain("Not confirmed yet");
    expect(rowOf(html, "replies")).not.toContain("Check");
    expect(rowOf(html, "daily-run")).toContain("Not working");
    expect(rowOf(html, "yelp")).toContain("Check");
  });

  it("exposes the tone for styling and tests", () => {
    for (const item of items) expect(html).toContain(`data-connection="${item.key}" data-tone="${item.tone}"`);
  });

  it("shows the next step only when there is one", () => {
    expect(rowOf(html, "mail")).not.toContain("Next step");
    expect(rowOf(html, "replies")).toContain("Next step: Mark replies by hand.");
  });

  it("offers Test connection only for services that can be tested", () => {
    expect(rowOf(html, "mail")).toContain("Test connection");
    expect(rowOf(html, "yelp")).toContain('aria-label="Test connection: Yelp search"');
    expect(rowOf(html, "replies")).not.toContain("Test connection");
    expect(rowOf(html, "daily-run")).not.toContain("Test connection");
  });
});
