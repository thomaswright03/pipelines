import { describe, expect, it } from "vitest";
import { extractEmails, findEmailCandidatesOnWebsite, findEmailForBusiness } from "@/lib/email-finder";
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

describe("findEmailCandidatesOnWebsite", () => {
  it("follows the site's own Contact link when the homepage has no address", async () => {
    stubFetch({
      "https://www.bakery.test": page(`<a href="/about/get-in-touch">Contact us</a>`),
      "https://www.bakery.test/about/get-in-touch": page(`hello@bakery.test`),
    });
    expect(await findEmailCandidatesOnWebsite("https://www.bakery.test")).toEqual(["hello@bakery.test"]);
  });

  it("returns nothing (not an error) for an unreachable site", async () => {
    stubFetch({});
    expect(await findEmailCandidatesOnWebsite("https://www.nowhere.test")).toEqual([]);
  });

  it("returns the best address the filter accepts", async () => {
    stubFetch({ "https://www.bakery.test": page(`info@bakery.test jane@bakery.test`) });
    expect(await findEmailForBusiness("https://www.bakery.test")).toBe("info@bakery.test");
    expect(await findEmailForBusiness("https://www.bakery.test", (e) => e.startsWith("jane"))).toBe("jane@bakery.test");
  });
});
