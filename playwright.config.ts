import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { E2E_DATABASE_URL } from "./e2e/db";

// Browser smoke tests against a production build (`npm run build` first)
// served locally. Email goes to the local outbox (EMAIL_TRANSPORT=outbox),
// never to a real mail service, and the app talks only to the local test
// database.
const PORT = 4100;
export const OUTBOX_DIR = path.resolve(__dirname, "test-results/e2e-outbox");

export default defineConfig({
  testDir: "e2e",
  workers: 1, // one shared database
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Creates/migrates the local test database, then serves the build.
    command: `node e2e/prepare-db.mjs && npx next start -p ${PORT} -H 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      E2E_DATABASE_URL,
      PIPELINES_DATABASE_URL: E2E_DATABASE_URL,
      PIPELINES_DIRECT_URL: E2E_DATABASE_URL,
      PIPELINES_DB_DRIVER: "pg",
      EMAIL_TRANSPORT: "outbox",
      OUTBOX_DIR,
      VERCEL: "",
      ZEPTOMAIL_SMTP_PASSWORD: "",
      YELP_API_KEY: "",
    },
  },
});
