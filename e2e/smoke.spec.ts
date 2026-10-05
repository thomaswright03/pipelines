// Browser smoke tests of the flows an operator depends on. Mail goes to the
// local outbox only (see playwright.config.ts).
import { readdir, rm } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { count, leadStatus, resetDb, seedAgentLead, seedColdLeads, withDb } from "./db";
import { OUTBOX_DIR } from "../playwright.config";
import { outageHtml } from "../src/lib/outage-page";

async function outboxCount(): Promise<number> {
  try {
    return (await readdir(OUTBOX_DIR)).filter((f) => f.endsWith(".eml")).length;
  } catch {
    return 0;
  }
}

test.beforeEach(async () => {
  await resetDb();
  await rm(OUTBOX_DIR, { recursive: true, force: true });
});

test("adding a lead rejects an invalid email, then saves a valid one", async ({ page }) => {
  await page.goto("/vault-pipeline/new");
  await page.locator("#field-name").fill("Acme Plumbing");
  await page.locator("#field-email").fill("not-an-email");
  await page.getByRole("button", { name: "Add lead" }).click();

  await expect(page.locator("#field-email-error")).toHaveText("Enter a full email address, like name@business.com");
  await expect(page.locator("#field-email")).toHaveAttribute("aria-invalid", "true");
  expect(await count(`SELECT count(*) AS n FROM "Lead"`)).toBe(0);

  await page.locator("#field-email").fill("owner@acmeplumbing.test");
  await page.getByRole("button", { name: "Add lead" }).click();
  await expect(page).toHaveURL(/\/vault-pipeline\/[a-z0-9]+$/);
  await expect(page.getByRole("heading", { name: "Acme Plumbing" })).toBeVisible();
  expect(await count(`SELECT count(*) AS n FROM "Lead" WHERE email = 'owner@acmeplumbing.test'`)).toBe(1);
});

test("a single send asks first, emails once and moves the lead to Contacted", async ({ page }) => {
  const [id] = await seedColdLeads(1);
  await page.goto(`/vault-pipeline/${id}`);

  await page.getByRole("button", { name: "Send outreach email" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("owner1@business1.test");
  await dialog.getByRole("button", { name: "Send email" }).click();

  await expect(page.getByText(/Sent the pitch to Test Business 1/)).toBeVisible();
  expect(await leadStatus(id!)).toBe("contacted");
  expect(await outboxCount()).toBe(1);
  await expect(page.getByRole("button", { name: "Send outreach email" })).toHaveCount(0);
});

test("a bulk send shows who it will email, and Stop halts it after the email in progress", async ({ page }) => {
  await seedColdLeads(25);
  await page.goto("/vault-pipeline");
  await expect(page.getByText("25 leads ready to email.")).toBeVisible();

  await page.getByRole("button", { name: "Send outreach to new leads…" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("25 leads");
  await dialog.getByRole("button", { name: "Send to 25 leads" }).click();
  await dialog.getByRole("button", { name: "Stop sending" }).click();
  await expect(dialog.getByRole("button", { name: "Stopping after this email…" })).toBeDisabled();

  await expect(dialog.getByText(/You stopped the send\./)).toBeVisible({ timeout: 60_000 });
  const sent = await count(`SELECT count(*) AS n FROM "Lead" WHERE status = 'contacted'`);
  // One email per server call: at most the one in progress when Stop was pressed (plus one racing it).
  expect(sent).toBeLessThanOrEqual(2);
  expect(await outboxCount()).toBe(sent);

  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(page.getByText(`${25 - sent} leads ready to email.`)).toBeVisible();
});

test("pausing outbound email blocks sending everywhere until resumed", async ({ page }) => {
  const [id] = await seedColdLeads(1);
  await page.goto("/settings");
  await page.getByRole("button", { name: "Pause all outbound email" }).click();
  await expect(page.getByRole("heading", { name: "Outbound email: paused" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Outbound email paused" })).toBeVisible();

  await page.goto(`/vault-pipeline/${id}`);
  await expect(page.getByRole("button", { name: "Send outreach email" })).toBeDisabled();
  await page.goto("/vault-pipeline");
  await expect(page.getByRole("button", { name: "Send outreach to new leads…" })).toBeDisabled();

  await page.goto("/settings");
  await page.getByRole("button", { name: "Resume outbound email" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Resume sending" }).click();
  await expect(page.getByRole("heading", { name: "Outbound email: on" })).toBeVisible();
  await page.goto(`/vault-pipeline/${id}`);
  await expect(page.getByRole("button", { name: "Send outreach email" })).toBeEnabled();
  expect(await outboxCount()).toBe(0);
});

test("pressing Enter on a destructive confirmation cancels it", async ({ page }) => {
  const [id] = await seedColdLeads(1);
  await page.goto(`/vault-pipeline/${id}`);
  await page.getByRole("button", { name: "Mark opted out" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  expect(await count(`SELECT count(*) AS n FROM "SuppressedEmail"`)).toBe(0);
  expect(await leadStatus(id!)).toBe("new");
});

test("pressing Enter on a send confirmation sends", async ({ page }) => {
  const [id] = await seedColdLeads(1);
  await page.goto(`/vault-pipeline/${id}`);
  await page.getByRole("button", { name: "Send outreach email" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Send email" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/Sent the pitch to Test Business 1/)).toBeVisible();
  expect(await outboxCount()).toBe(1);
});

test("a lead's details can be edited, with a link to whoever already holds an address", async ({ page }) => {
  const [id, otherId] = await seedColdLeads(2);
  await page.goto(`/vault-pipeline/${id}`);
  await page.getByRole("link", { name: "Edit details" }).click();
  await expect(page).toHaveTitle(/^Edit Test Business 1/);

  await page.locator("#field-email").fill("owner2@business2.test");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator("#field-email-error")).toContainText("already belongs to Test Business 2");
  await expect(page.locator("#field-email-error").getByRole("link", { name: "Open Test Business 2" })).toHaveAttribute(
    "href",
    `/vault-pipeline/${otherId}`,
  );

  await page.locator("#field-email").fill("fixed@business1.test");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(new RegExp(`/vault-pipeline/${id}$`));
  await expect(page.getByRole("link", { name: "fixed@business1.test" })).toBeVisible();
  await expect(page.getByText(/Entered by hand on/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Send outreach email" })).toBeEnabled();
});

test("leaving a form with unsaved changes asks first; a saved form doesn't", async ({ page }) => {
  const [id] = await seedColdLeads(1);
  await page.goto(`/vault-pipeline/${id}/edit`);
  const back = page.getByRole("link", { name: "← Back to Test Business 1" });

  // Nothing typed yet: leaving just leaves.
  await back.click();
  await expect(page).toHaveURL(new RegExp(`/vault-pipeline/${id}$`));

  await page.goto(`/vault-pipeline/${id}/edit`);
  await page.locator("#field-notes").fill("Call back after 3pm");
  await back.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Leave without saving?" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/vault-pipeline/${id}/edit$`));
  await expect(page.locator("#field-notes")).toHaveValue("Call back after 3pm");

  await back.click();
  await page.getByRole("dialog").getByRole("button", { name: "Leave without saving" }).click();
  await expect(page).toHaveURL(new RegExp(`/vault-pipeline/${id}$`));

  // Saving navigates away without asking.
  await page.goto(`/vault-pipeline/${id}/edit`);
  await page.locator("#field-notes").fill("Saved note");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(new RegExp(`/vault-pipeline/${id}$`));
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("deleting a lead asks first, naming it, then removes it from the list", async ({ page }) => {
  const [id] = await seedColdLeads(1);
  await page.goto(`/vault-pipeline/${id}`);
  await page.getByRole("button", { name: "Delete lead…" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Delete Test Business 1?" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await dialog.getByRole("button", { name: "Delete Test Business 1" }).click();
  await expect(page).toHaveURL(/\/vault-pipeline$/);
  expect(await count(`SELECT count(*) AS n FROM "Lead"`)).toBe(0);
});

test("a reply from an unknown address can be attached to the right lead", async ({ page }) => {
  const [id] = await seedColdLeads(1, { status: "contacted" });
  await withDb((db) =>
    db.query(
      `INSERT INTO "InboundReply" (id, "dedupeKey", "fromEmail", subject, "optedOut", matched, text, "receivedAt")
       VALUES ('r1', 'mid:r1', 'assistant@otherdomain.test', 'Re: hello', false, '{}', 'Forwarding for my boss - interested!', now())`,
    ),
  );
  await page.goto("/vault-pipeline");
  await page.getByRole("link", { name: "Match it to a lead" }).click();
  await expect(page).toHaveTitle(/^Unmatched replies/);
  await expect(page.getByText("Forwarding for my boss - interested!")).toBeVisible();

  await page.getByLabel("Find the lead it belongs to").fill("Test Business 1");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("button", { name: "Attach" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Add reply" }).click();
  await expect(page.getByText(/moved to Responded/)).toBeVisible();
  expect(await leadStatus(id!)).toBe("responded");
});

test("a lead is marked Lost in one place, and only with a reason", async ({ page }) => {
  const [id] = await seedColdLeads(1, { status: "contacted" });
  await page.goto(`/vault-pipeline/${id}`);
  await expect(page.getByRole("option", { name: "Lost" })).toHaveCount(1);
  await page.getByRole("combobox", { name: "Move to…" }).selectOption("lost");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Mark lost" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Pick one to continue.");
  await dialog.getByRole("combobox", { name: "Why was the lead lost?" }).selectOption("no_need");
  await dialog.getByRole("button", { name: "Mark lost" }).click();
  await expect(page.getByText(/to Lost \(No need\)\./)).toBeVisible();
  expect(await leadStatus(id!)).toBe("lost");
});

test("starting another control clears the previous control's message", async ({ page }) => {
  await page.goto("/vault-pipeline");
  // No Yelp key in the browser tests, so this fails straight away with a message.
  await page.getByRole("button", { name: "Find leads in the next city" }).click();
  await expect(page.locator(".notice-error", { hasText: "Yelp isn't set up yet" })).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Search a specific city" }).click();
  await page.getByRole("region", { name: "Pipeline controls" }).getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText("Enter a city.")).toBeVisible();
  await expect(page.locator(".notice-error")).toHaveCount(1);
});

test("every page has its own tab title", async ({ page }) => {
  const [id] = await seedColdLeads(1);
  const expected: [string, RegExp][] = [
    ["/", /^Cold email outreach · Dashboard$/],
    ["/vault-pipeline", /^Cold Outreach — Leads/],
    ["/vault-pipeline/cold-call", /^Cold Outreach — Call deck/],
    ["/dataleadsell/stats", /^dataleadsell — Stats/],
    ["/settings", /^Settings/],
    ["/help", /^Operator guide/],
    [`/vault-pipeline/${id}`, /^Test Business 1 — Cold Outreach/],
    ["/nope", /^Page not found · Outreach$/],
  ];
  for (const [path, title] of expected) {
    await page.goto(path);
    await expect(page).toHaveTitle(title);
  }
  expect((await page.goto("/nope"))?.status()).toBe(404);
  await expect(page.getByText("This page doesn't exist.")).toBeVisible();
});

async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const width of [375, 390, 768, 1280, 1440, 2560]) {
  test(`the lead list fits a ${width}px screen with every lead's status visible`, async ({ page }) => {
    const longName = "The Extremely Long Named Family Owned Plumbing Heating Cooling and Drain Cleaning Company of Phoenix";
    await seedColdLeads(3, { name: (i) => (i === 1 ? longName : `Business ${i}`), status: "contacted" });
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/vault-pipeline");

    await expectNoSidewaysScroll(page);
    const list = page.getByRole("region", { name: "leads list" });
    const table = list.locator("table");
    if (width >= 768) {
      await expect(table).toBeVisible();
      const clipped = await table.evaluate((t) => t.scrollWidth - (t.parentElement?.clientWidth ?? t.scrollWidth));
      expect(clipped).toBeLessThanOrEqual(0);
    } else {
      await expect(table).toBeHidden();
    }
    // Status is visible for every lead without scrolling sideways.
    const badges = list.getByText("Contacted", { exact: true }).filter({ visible: true });
    await expect(badges).toHaveCount(3);
    for (const badge of await badges.all()) {
      const box = (await badge.boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    await expect(list.getByRole("link", { name: longName }).filter({ visible: true })).toHaveAttribute("title", longName);

    if (width < 768) {
      // The long name shows at most two lines, and nothing of it is drawn over the contact line beneath.
      const card = list.locator("li").filter({ hasText: "owner1@business1.test" });
      const clamp = await card.evaluate((li) => {
        const el = [...li.querySelectorAll<HTMLElement>("*")].find((e) => getComputedStyle(e).webkitLineClamp === "2")!;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return {
          // Overflow is clipped at the padding box, so that is the most of the name that can show.
          visibleBottom: rect.bottom - parseFloat(style.borderBottomWidth),
          textHeight: rect.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
          lineHeight: parseFloat(style.lineHeight),
          clamped: el.scrollHeight > el.clientHeight,
        };
      });
      expect(clamp.clamped).toBe(true);
      expect(clamp.textHeight).toBeLessThanOrEqual(2 * clamp.lineHeight + 1);
      const contact = (await card.getByText("owner1@business1.test").boundingBox())!;
      expect(clamp.visibleBottom).toBeLessThanOrEqual(contact.y + 0.5);
    }
  });
}

test("on a phone the header is one short row, and the menu holds the pages and the theme", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/vault-pipeline");
  const header = page.locator("body > header");
  expect((await header.boundingBox())!.height).toBeLessThanOrEqual(64);
  expect((await page.getByRole("heading", { name: "Cold Outreach", level: 1 }).boundingBox())!.y).toBeLessThan(150);

  const menu = page.getByRole("button", { name: "Menu" });
  await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("combobox", { name: "Theme" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
  await menu.click();
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: /^Settings/ })
    .click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden(); // closed after following a link

  // From the sm breakpoint up the pages sit in the header, with no Menu button.
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  await expect(menu).toBeHidden();
});

test("at 1440×900 the lead list is on the first screen, and its column headers stay pinned while scrolling", async ({ page }) => {
  await seedColdLeads(50, { status: "contacted" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/vault-pipeline");
  const list = page.getByRole("region", { name: "leads list" });
  await expect(list.getByRole("navigation", { name: "Filter by status" })).toBeInViewport();
  const firstRow = list.locator("tbody tr").first();
  expect((await firstRow.boundingBox())!.y + 20).toBeLessThan(900);

  const headerRow = list.locator("thead th").nth(1);
  await list.locator("tbody tr").nth(40).scrollIntoViewIfNeeded();
  const siteHeader = (await page.locator("body > header").boundingBox())!;
  const pinned = (await headerRow.boundingBox())!;
  expect(pinned.y).toBeGreaterThanOrEqual(siteHeader.y + siteHeader.height - 1);
  expect(pinned.y).toBeLessThan(siteHeader.y + siteHeader.height + 4);
  await expect(list.getByRole("link", { name: /Emailed/ })).toBeInViewport();
});

test("on a phone the row links, filter chips and page links are at least 44px tall", async ({ page }) => {
  await seedColdLeads(60, { status: "contacted" });
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/vault-pipeline");
  const list = page.getByRole("region", { name: "leads list" });
  const targets = [
    ...(await list.getByRole("navigation", { name: "Filter by status" }).getByRole("link").all()),
    ...(await list.locator("ul").getByRole("link").all()),
    ...(await list.getByRole("navigation", { name: "Pages" }).getByRole("link").all()),
    page.getByRole("button", { name: "Menu" }),
  ];
  expect(targets.length).toBeGreaterThan(30);
  for (const target of targets) {
    const box = (await target.boundingBox())!;
    expect(box.height, (await target.textContent()) ?? "").toBeGreaterThanOrEqual(44);
  }
});

for (const pipeline of ["vault-pipeline", "dataleadsell"] as const) {
  test(`on a phone, a ${pipeline} lead's status and Send come before the email preview`, async ({ page }) => {
    const id = pipeline === "vault-pipeline" ? (await seedColdLeads(1))[0]! : await seedAgentLead();
    await page.setViewportSize({ width: 375, height: 900 });
    await page.goto(`/${pipeline}/${id}`);

    await expectNoSidewaysScroll(page);
    const send = page.getByRole("button", { name: "Send outreach email" });
    const moveTo = page.getByRole("combobox", { name: "Move to…" });
    const preview = page.getByRole("heading", { name: "Outreach email preview" });
    for (const control of [send, moveTo]) {
      const box = (await control.boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(2 * 900); // within the first two screens
      expect(box.y).toBeLessThan((await preview.boundingBox())!.y);
    }

    // From the md breakpoint up, the actions stay in the right-hand column beside the details.
    await page.setViewportSize({ width: 1440, height: 900 });
    const sendBox = (await send.boundingBox())!;
    const previewBox = (await preview.boundingBox())!;
    expect(sendBox.x).toBeGreaterThan(previewBox.x + previewBox.width);
    await expect(send).toBeInViewport();
  });
}

test("each stats bar can be read: its date and count on hover or focus", async ({ page }) => {
  await seedColdLeads(3);
  await page.goto("/vault-pipeline/stats");
  const bars = page.getByRole("list", { name: "leads added, by day" }).getByRole("listitem");
  await expect(bars).toHaveCount(14);
  const today = bars.last();
  await expect(today).toHaveAccessibleName(/^[A-Z][a-z]{2} \d{1,2}: 3 leads added$/);
  await today.focus();
  await expect(today.getByRole("tooltip")).toBeVisible();
  await expect(today.getByRole("tooltip")).toHaveText(/: 3 leads added$/);
});

test("a call-deck card gives the caller context, opens the lead in a new tab, and keeps its place on refresh", async ({ page }) => {
  const [first, second] = await seedColdLeads(2, { status: "cold_call_list" });
  await withDb(async (db) => {
    await db.query(`UPDATE "Lead" SET company = 'Bob''s Bakery', "lastEmailedAt" = '2026-09-10T18:00:00Z' WHERE id = $1`, [first]);
    await db.query(
      `INSERT INTO "LeadActivity" (id, "leadId", type, notes, date) VALUES ('a1', $1, 'note', 'Owner is in after 3pm', '2026-09-12T18:00:00Z')`,
      [first],
    );
  });
  await page.goto("/vault-pipeline/cold-call");

  await expect(page.getByRole("heading", { name: "Test Business 1" })).toBeVisible();
  await expect(page.getByText("Bob's Bakery")).toBeVisible();
  await expect(page.getByText("Phoenix, AZ")).toBeVisible();
  await expect(page.getByText("Emailed Sep 10, 2026")).toBeVisible();
  await expect(page.getByText("Owner is in after 3pm")).toBeVisible();
  const leadLink = page.getByRole("link", { name: /Open lead page/ });
  await expect(leadLink).toHaveAttribute("href", `/vault-pipeline/${first}`);
  await expect(leadLink).toHaveAttribute("target", "_blank");

  await page.getByRole("button", { name: "Didn't answer" }).click();
  await page.getByRole("button", { name: "Save and next" }).click();
  await expect(page.getByRole("heading", { name: "Test Business 2" })).toBeVisible();
  await expect(page.getByText("Never emailed")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Test Business 2" })).toBeVisible();
  await expect(page.getByText("Card 2 of 2")).toBeVisible();
  expect(second).toBeTruthy();
});

test("an empty lead list shows one first-run message; a search with no hits shows only that, with Clear", async ({ page }) => {
  for (const path of ["/vault-pipeline", "/dataleadsell"]) {
    await page.goto(path);
    const list = page.getByRole("region", { name: /list$/ });
    await expect(list.getByText(/yet — search for some with the tools below the list, or add one by hand\./)).toBeVisible();
    await expect(list.getByText(/match/)).toHaveCount(0);
  }

  await seedColdLeads(2);
  await page.goto("/vault-pipeline?q=zzz");
  const list = page.getByRole("region", { name: "leads list" });
  await expect(list.getByText("No leads match “zzz”.")).toBeVisible();
  await expect(list.getByText(/yet —/)).toHaveCount(0);
  await list.getByRole("link", { name: "Clear search" }).click();
  await expect(page.getByText("Showing 1–2 of 2 leads")).toBeVisible();
});

for (const width of [375, 768, 1440, 2560]) {
  test(`the sender address never breaks inside itself at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/vault-pipeline", "/dataleadsell"]) {
      await page.goto(path);
      const lines = await page
        .locator("main p code")
        .first()
        .evaluate((code) => {
          const range = document.createRange();
          range.selectNodeContents(code);
          return new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top))).size;
        });
      expect(lines).toBe(1);
    }
  });
}

test("Settings shows whether each connection is working", async ({ page }) => {
  await withDb((db) =>
    db.query(
      `INSERT INTO "PipelineRun" (id, pipeline, kind, status, summary, "startedAt", "finishedAt")
       VALUES ('run1', 'cold-outreach', 'daily', 'failed', 'The run stopped with an error.', now(), now())`,
    ),
  );
  await page.goto("/settings");
  const connections = page.getByRole("region", { name: "Connections" });
  await expect(connections.locator('[data-connection="daily-run"]')).toHaveAttribute("data-tone", "error");
  await expect(connections.locator('[data-connection="daily-run"]')).toContainText("The run stopped with an error.");
  // The browser tests use the local outbox and no Yelp key.
  await expect(connections.locator('[data-connection="mail"]')).toContainText("Test mode");
  await expect(connections.locator('[data-connection="yelp"]')).toHaveAttribute("data-tone", "error");
  // Nothing has proved reply forwarding works (and its secret isn't set here), so it isn't shown as working.
  await expect(connections.locator('[data-connection="replies"]')).not.toHaveAttribute("data-tone", "ok");

  // "Test connection" logs in to the mail service (here, the local outbox) without sending.
  await connections.getByRole("button", { name: "Test connection: Sending email" }).click();
  await expect(connections.locator('[data-connection="mail"]').getByRole("status")).toContainText("No email was sent");
  await expect(connections.locator('[data-connection="mail"]')).toContainText("Connection test passed");
});

for (const width of [1024, 1280, 1440]) {
  test(`at ${width}px the header is one row, even with every status pill showing`, async ({ page }) => {
    // Sending paused, and a pitch 3 days old with no reply since: both pills show, next to the outbox badge.
    await withDb(async (db) => {
      await db.query(`INSERT INTO "AppSettings" (id, "outboundPaused", "pausedAt", "updatedAt") VALUES ('global', true, now(), now())`);
      await db.query(
        `INSERT INTO "OutreachRecipient" (id, pipeline, email, state, "claimedAt", "sentAt")
         VALUES ('r1', 'cold-outreach', 'old@x.test', 'sent', now() - interval '3 days', now() - interval '3 days')`,
      );
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const header = page.locator("body > header");
    await expect(header.getByRole("link", { name: "Outbound email paused" })).toBeVisible();
    await expect(header.getByRole("link", { name: /Replies not arriving/ })).toBeVisible();
    expect((await header.boundingBox())!.height).toBeLessThanOrEqual(72);
    // Every page link and pill sits on the same line, each on one line of its own.
    const tops = await header
      .locator("nav a, a[href='/settings'], a[href='/replies']")
      .evaluateAll((links) => links.filter((a) => (a as HTMLElement).offsetParent !== null).map((a) => a.getClientRects().length));
    expect(tops.every((lines) => lines === 1)).toBe(true);
    const rowTops = await header
      .locator("nav a")
      .evaluateAll((links) => new Set(links.map((a) => Math.round(a.getBoundingClientRect().top))).size);
    expect(rowTops).toBe(1);
    // Each pill's visible text (one word each below 1400px) is shown whole, not squeezed.
    const squeezed = await header
      .locator("a[href='/settings'] span, a[href='/replies'] span, a[href^='/settings#'] span")
      .evaluateAll((spans) =>
        spans
          .filter((s) => (s as HTMLElement).offsetParent !== null && s.getAttribute("role") !== "tooltip" && s.textContent)
          .filter((s) => s.scrollWidth > s.clientWidth + 1 || s.getBoundingClientRect().width < 8)
          .map((s) => s.textContent),
      );
    expect(squeezed).toEqual([]);
    if (width >= 1440) {
      // Wide enough that the mail, paused and replies pills show their whole text.
      const cut = await header
        .locator("a[href='/settings'] .truncate, a[href='/replies'] .truncate, a[href^='/settings#'] .truncate")
        .evaluateAll((spans) => spans.filter((s) => s.scrollWidth > s.clientWidth).map((s) => s.textContent));
      expect(cut).toEqual([]);
    }
  });
}

test("at 375px the header stays one row with every status pill showing, and the menu gives each in full", async ({ page }) => {
  await withDb(async (db) => {
    await db.query(`INSERT INTO "AppSettings" (id, "outboundPaused", "pausedAt", "updatedAt") VALUES ('global', true, now(), now())`);
    await db.query(
      `INSERT INTO "OutreachRecipient" (id, pipeline, email, state, "claimedAt", "sentAt")
       VALUES ('r1', 'cold-outreach', 'old@x.test', 'sent', now() - interval '3 days', now() - interval '3 days')`,
    );
  });
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/");
  const header = page.locator("body > header");
  for (const name of ["Outbound email paused", /Replies not arriving/, /Test mode/]) {
    await expect(header.getByRole("link", { name })).toBeVisible();
  }
  expect((await header.boundingBox())!.height).toBeLessThanOrEqual(64);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

  await header.getByRole("button", { name: "Menu" }).click();
  const status = header.getByRole("list", { name: "Status" });
  await expect(status).toContainText("Sending paused.");
  await expect(status).toContainText("Replies not arriving.");
  await expect(status).toContainText("Test mode: mail saved, not sent.");
});

test("the dashboard's numbers line up in every row of tiles, at phone, tablet and desktop widths", async ({ page }) => {
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    // Each tile's number, with the top of the tile it sits in.
    const numbers = await page.locator("dl dd a[aria-label]").evaluateAll((links) =>
      links.map((a) => ({
        tileTop: Math.round(a.closest("div")!.getBoundingClientRect().top),
        bottom: Math.round(a.getBoundingClientRect().bottom),
      })),
    );
    expect(numbers.length, `${width}px`).toBeGreaterThanOrEqual(8);
    const rows = new Map<number, Set<number>>();
    for (const { tileTop, bottom } of numbers) rows.set(tileTop, (rows.get(tileTop) ?? new Set()).add(bottom));
    for (const [top, bottoms] of rows) expect([...bottoms], `${width}px, tiles at y=${top}`).toHaveLength(1);
  }
});

test("at 375px the do-not-email list shows each address whole, with its date, reason and a 44px Remove", async ({ page }) => {
  const long = "accounts.receivable.department@very-long-business-name-example.test";
  await withDb(async (db) => {
    await db.query(
      `INSERT INTO "SuppressedEmail" (email, source, reason) VALUES ($1, 'manual', 'Asked by phone'), ('stop@x.test', 'inbound_reply', NULL)`,
      [long],
    );
  });
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/settings");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

  const row = page.getByRole("listitem").filter({ hasText: "accounts.receivable" });
  await expect(row).toContainText(/Why: \S/);
  await expect(row).toContainText(/Since /);
  const box = (await row.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(375);
  // The address wraps only after the @ or a hyphen, or before a dot: no piece of it is split across lines.
  const splitPieces = await row.locator("span.font-medium > span").evaluateAll((pieces) =>
    pieces
      .filter((piece) => {
        const range = document.createRange();
        range.selectNodeContents(piece);
        // A break right after a piece leaves an empty box on the next line; only drawn text counts.
        const drawn = Array.from(range.getClientRects()).filter((r) => r.width > 0);
        return new Set(drawn.map((r) => Math.round(r.top))).size > 1;
      })
      .map((piece) => piece.textContent),
  );
  expect(splitPieces).toEqual([]);
  const remove = row.getByRole("button", { name: `Remove ${long} from the list` });
  expect((await remove.boundingBox())!.height).toBeGreaterThanOrEqual(44);
});

/**
 * WCAG contrast ratio of the element's text against what is painted behind it: its own and its
 * ancestors' background colours, composited. A gradient on the element itself (a primary button's
 * top-to-bottom shade) counts by its colour halfway along, behind the vertically centred text.
 */
async function textContrast(page: Page, selector: string): Promise<number> {
  return page.locator(selector).evaluate((el) => {
    // Canvas turns any CSS colour (Tailwind's oklch included) into sRGB bytes.
    const ctx = document.createElement("canvas").getContext("2d")!;
    const rgba = (color: string) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return [r!, g!, b!, a! / 255] as const;
    };
    const over = (top: readonly number[], under: readonly number[]) => [0, 1, 2].map((i) => top[i]! * top[3]! + under[i]! * (1 - top[3]!));
    const luminance = (c: readonly number[]) => {
      const [r, g, b] = c.slice(0, 3).map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    // Background layers from the element outwards, down to the first opaque one.
    const layers: (readonly number[])[] = [];
    for (let node: Element | null = el; node; node = node.parentElement) {
      const bg = rgba(getComputedStyle(node).backgroundColor);
      if (bg[3] > 0) layers.push(bg);
      if (bg[3] === 1) break;
    }
    let behind: readonly number[] = [255, 255, 255];
    for (const layer of layers.reverse()) behind = over(layer, behind);
    const stops = (getComputedStyle(el).backgroundImage.match(/(?:rgba?|oklch|oklab|color)\([^)]*\)|#[0-9a-f]{3,8}/gi) ?? []).map(rgba);
    const middle = stops.length > 0 ? [0, 1, 2, 3].map((i) => (stops[0]![i]! + stops.at(-1)![i]!) / 2) : null;
    const backgrounds = middle ? [over(middle, behind)] : [behind];
    const text = luminance(over(rgba(getComputedStyle(el).color), behind));
    return Math.min(
      ...backgrounds.map((b) => {
        const back = luminance(b);
        return (Math.max(text, back) + 0.05) / (Math.min(text, back) + 0.05);
      }),
    );
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`the skip link is readable when it takes focus, in the ${theme} theme`, async ({ page }) => {
    for (const how of ["system", "picked"] as const) {
      if (how === "system") {
        await page.emulateMedia({ colorScheme: theme });
      } else {
        // The opposite system setting, overridden by the header's theme choice.
        await page.emulateMedia({ colorScheme: theme === "dark" ? "light" : "dark" });
        await page.addInitScript((t) => localStorage.setItem("theme", t), theme);
      }
      await page.goto("/");
      await page.keyboard.press("Tab");
      const skip = page.getByRole("link", { name: "Skip to content" });
      await expect(skip).toBeFocused();
      await expect(skip).toBeVisible();
      expect(await textContrast(page, "a[href='#main']"), `${theme} theme (${how})`).toBeGreaterThanOrEqual(4.5);
    }
  });
}

test("the browser tab and home-screen icons are the header's O mark, not the framework default", async ({ page, request }) => {
  await page.goto("/");
  const icons = await page
    .locator("head link[rel='icon'], head link[rel='apple-touch-icon']")
    .evaluateAll((links) => links.map((l) => `${l.getAttribute("rel")} ${l.getAttribute("href")?.split("?")[0]}`));
  expect(icons).toEqual(expect.arrayContaining(["icon /favicon.ico", "icon /icon.svg", "apple-touch-icon /apple-icon.png"]));
  const svg = await (await request.get("/icon.svg")).text();
  // The header mark's gradient (indigo-500 to violet-600).
  expect(svg).toContain("#6366f1");
  expect(svg).toContain("#7c3aed");
  const ico = await request.get("/favicon.ico");
  expect(ico.ok()).toBe(true);
  // create-next-app's favicon is 25,931 bytes; ours holds 16, 32 and 48 px renders of icon.svg.
  const body = await ico.body();
  expect(body.length).not.toBe(25_931);
  expect(body.readUInt16LE(4)).toBe(3);
});

for (const theme of ["light", "dark"] as const) {
  test(`the database-down page uses the app's font, mark and ${theme} theme, readably`, async ({ page }) => {
    // The page Proxy serves during an outage, delivered from the app's own origin so its font and icon load as they would.
    const html = outageHtml();
    await page.route("**/outage-preview", (route) => route.fulfill({ status: 503, contentType: "text/html; charset=utf-8", body: html }));
    await page.emulateMedia({ colorScheme: theme });
    await page.goto("/outage-preview");
    await expect(page.getByRole("heading", { name: "Can't reach the database right now" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Try again" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Outreach — dashboard" })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.fonts.check("16px Geist"))).toBe(true);
    expect(await page.locator("body").evaluate((b) => getComputedStyle(b).fontFamily)).toMatch(/^Geist/);
    const background = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--background").trim());
    expect(background).toBe(theme === "dark" ? "#0a0a0c" : "#f7f7fb");
    for (const selector of ["h1", ".card p", "a.btn"]) {
      expect(await textContrast(page, selector), `${selector} in the ${theme} theme`).toBeGreaterThanOrEqual(4.5);
    }
  });
}

test("the database-down page follows a theme picked in the header over the system setting", async ({ page }) => {
  const html = outageHtml();
  await page.route("**/outage-preview", (route) => route.fulfill({ status: 503, contentType: "text/html; charset=utf-8", body: html }));
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => localStorage.setItem("theme", "dark"));
  await page.goto("/outage-preview");
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--background").trim())).toBe("#0a0a0c");
});

test("each dashboard card's buttons are named after its pipeline", async ({ page }) => {
  await page.goto("/");
  const edits = await page
    .getByRole("button", { name: /^Edit .+ description$/ })
    .evaluateAll((b) => b.map((e) => e.getAttribute("aria-label")));
  expect(edits.length).toBeGreaterThanOrEqual(3);
  expect(new Set(edits).size).toBe(edits.length);
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Sent & replies: Cold Outreach" })).toHaveAttribute("href", "/vault-pipeline/inbox");
});
