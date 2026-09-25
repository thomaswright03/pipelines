// Browser smoke tests of the flows an operator depends on. Mail goes to the
// local outbox only (see playwright.config.ts).
import { readdir, rm } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { count, leadStatus, resetDb, seedColdLeads } from "./db";
import { OUTBOX_DIR } from "../playwright.config";

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

test("a bulk send shows who it will email, and Stop halts it between batches", async ({ page }) => {
  await seedColdLeads(25);
  await page.goto("/vault-pipeline");
  await expect(page.getByText("25 leads found but not yet emailed.")).toBeVisible();

  await page.getByRole("button", { name: "Send outreach to new leads…" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("25 leads");
  await dialog.getByRole("button", { name: "Send to 25 leads" }).click();
  await dialog.getByRole("button", { name: "Stop sending" }).click();
  await expect(dialog.getByRole("button", { name: "Stopping after this batch…" })).toBeDisabled();

  await expect(dialog.getByText(/You stopped the send\./)).toBeVisible({ timeout: 60_000 });
  const sent = await count(`SELECT count(*) AS n FROM "Lead" WHERE status = 'contacted'`);
  expect(sent).toBeGreaterThan(0);
  expect(sent).toBeLessThan(25);
  expect(await outboxCount()).toBe(sent);

  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(page.getByText(`${25 - sent} leads found but not yet emailed.`)).toBeVisible();
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

async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const width of [375, 768, 1280, 1440, 2560]) {
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
  });
}
