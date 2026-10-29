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
  {
    key: "garbage-ai-daily",
    label: "Daily Garbage AI search",
    tone: "error",
    summary: "Last run failed.",
    next: "Open the Garbage AI page: it lists the run.",
    link: { href: "/garbage-ai", label: "Open the Garbage AI page" },
  },
  {
    key: "dataleadsell-daily",
    label: "Daily dataleadsell run",
    tone: "off",
    badge: "Off",
    summary: "Switched off.",
    next: "Turn it on.",
    link: { href: "/dataleadsell", label: "Open the dataleadsell.com page" },
  },
  {
    key: "places",
    label: "Business list",
    tone: "error",
    summary: "The business list is empty.",
    next: "Tell your developer.",
    testable: false,
  },
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
    expect(rowOf(html, "garbage-ai-daily")).toContain("Not working");
    expect(rowOf(html, "places")).toContain("Not working");
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
    expect(rowOf(html, "places")).not.toContain("Test connection");
    expect(rowOf(html, "replies")).not.toContain("Test connection");
    expect(rowOf(html, "garbage-ai-daily")).not.toContain("Test connection");
  });

  it("links a row's next step to the job's own page, and shows a switched-off job as Off, not as a problem", () => {
    expect(rowOf(html, "garbage-ai-daily")).toMatch(/href="\/garbage-ai"[^>]*>Open the Garbage AI page</);
    const off = rowOf(html, "dataleadsell-daily");
    expect(off).toContain('data-tone="off"');
    expect(off).toContain(">Off<");
    expect(off).not.toMatch(/Not working|Check/);
    expect(html).toContain('id="connection-mail"');
  });
});
