import { execSync } from "node:child_process";

// Brings the test database's schema up to date with prisma/migrations
// (non-destructive `migrate deploy`), so the suite always runs against the
// real schema history. Each test then empties the tables (tests/setup.ts),
// which is why this refuses anything but a local/CI database host.
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://ci:ci@localhost:5432/pipelines_test";
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "postgres"].includes(host) && process.env.ALLOW_NONLOCAL_TEST_DB !== "1") {
    throw new Error(`Refusing to run tests against non-local database host "${host}".`);
  }
  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, PIPELINES_DIRECT_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: "1" },
  });
}
