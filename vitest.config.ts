import path from "node:path";
import { defineConfig } from "vitest/config";

// Tests run against a real, disposable Postgres (TEST_DATABASE_URL, default
// a local "pipelines_test" database) with every outbound call faked: a
// capturing mail transport and a stubbed fetch. See tests/global-setup.ts.
const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? "postgresql://ci:ci@localhost:5432/pipelines_test";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    setupFiles: ["tests/setup.ts"],
    // Every file shares one database, so files run one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      PIPELINES_DATABASE_URL: testDatabaseUrl,
      PIPELINES_DIRECT_URL: testDatabaseUrl,
      PIPELINES_DB_DRIVER: "pg",
      EMAIL_TRANSPORT: "outbox",
      OUTBOX_DIR: path.resolve(__dirname, "node_modules/.cache/test-outbox"),
      EMAIL_INBOUND_SECRET: "test-inbound-secret",
      CRON_SECRET: "test-cron-secret",
      YELP_API_KEY: "test-yelp-key",
      ZEPTOMAIL_SMTP_PASSWORD: "",
      VERCEL: "",
    },
  },
});
