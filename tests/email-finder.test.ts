import { describe, expect, it, vi } from "vitest";
import { extractEmails, scanWebsite } from "@/lib/email-finder";
import { page, stubFetch } from "./helpers";

const MAILTO_PAGE = `<a href="mailto:info@acmeplumbing.test?subject=Hi">Email us</a> Call (480) 555-0101`;
const PLAIN_PAGE = `<p>Questions? Write to owner@zetaroofing.test any time.</p>`;

describe("extractEmails", () => {
  it("returns the complete address regardless of what was extracted before (both orders, repeatedly)", () => {
    for (let i = 0; i < 5; i++) {
      expect(extractEmails(MAILTO_PAGE)).toEqual(["info@acmeplumbing.test"]);
      expect(extractEmails(PLAIN_PAGE)).toEqual(["owner@zetaroofing.test"]);
    }
    for (let i = 0; i < 5; i++) {
      expect(extractEmails(PLAIN_PAGE)).toEqual(["owner@zetaroofing.test"]);
      expect(extractEmails(MAILTO_PAGE)).toEqual(["info@acmeplumbing.test"]);
    }
  });

  it("finds addresses in mailto links and in text, lower-cased and de-duplicated", () => {
    expect(
      extractEmails(`<a href="mailto:Sales@Shop.test">x</a> or SALES@shop.test, or jane.doe+web@shop.test.`),
    ).toEqual(["sales@shop.test", "jane.doe+web@shop.test"]);
  });

  it("ignores placeholders, template domains and image file names", () => {
    const html = `<input placeholder="you@yourdomain.com"> user@example.com logo@2x.png hero@3x.webp real@bakery.test`;
    expect(extractEmails(html)).toEqual(["real@bakery.test"]);
  });
});

describe("scanWebsite", () => {
  it("follows the site's own Contact link when the homepage has no address", async () => {
    stubFetch({
      "https://www.bakery.test": page(`<a href="/about/get-in-touch">Contact us</a>`),
      "https://www.bakery.test/about/get-in-touch": page(`hello@bakery.test`),
    });
    expect(await scanWebsite("https://www.bakery.test")).toMatchObject({ emails: ["hello@bakery.test"], unreachable: false });
  });

  it("ranks addresses found on more pages and shared inboxes first", async () => {
    stubFetch({ "https://www.bakery.test": page(`jane@bakery.test info@bakery.test`) });
    expect((await scanWebsite("https://www.bakery.test")).emails).toEqual(["info@bakery.test", "jane@bakery.test"]);
  });

  it("a domain that doesn't exist is a finished scan with no address", async () => {
    stubFetch({});
    expect(await scanWebsite("https://www.nowhere.test")).toEqual({ emails: [], pages: [], unreachable: false });
  });

  it("a page that answers 404 everywhere is a finished scan with no address", async () => {
    stubFetch({ "https://www.gone.test": () => ({ status: 404, body: "not found" }) });
    expect((await scanWebsite("https://www.gone.test")).unreachable).toBe(false);
  });

  it("a timeout, dropped connection or 5xx is reported as unreachable, not as 'no address'", async () => {
    for (const failure of [
      () => Promise.reject(new DOMException("The operation was aborted.", "TimeoutError")),
      () => Promise.reject(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } })),
      () => Promise.resolve(new Response("upstream down", { status: 503, headers: { "content-type": "text/html" } })),
    ]) {
      vi.stubGlobal("fetch", vi.fn(failure));
      expect(await scanWebsite("https://www.flaky.test")).toEqual({ emails: [], pages: [], unreachable: true });
    }
  });
});
