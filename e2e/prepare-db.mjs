// Runs before the browser tests' server starts: creates the test database
// if needed and applies prisma/migrations. Refuses anything but a local/CI
// host, because every test empties the tables.
import { execSync } from "node:child_process";
import pg from "pg";

const url = new URL(process.env.E2E_DATABASE_URL ?? "postgresql://ci:ci@localhost:5432/pipelines_e2e");
if (!["localhost", "127.0.0.1", "postgres"].includes(url.hostname)) {
  throw new Error(`Refusing to run browser tests against non-local database host "${url.hostname}".`);
}

const dbName = url.pathname.slice(1);
const admin = new URL(url);
admin.pathname = "/postgres";
const client = new pg.Client({ connectionString: admin.toString() });
await client.connect();
try {
  const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
  if (exists.rowCount === 0) await client.query(`CREATE DATABASE "${dbName.replace(/"/g, "")}"`);
} finally {
  await client.end();
}

execSync("npx prisma migrate deploy", {
  stdio: "inherit",
  env: { ...process.env, PIPELINES_DIRECT_URL: url.toString(), PRISMA_HIDE_UPDATE_MESSAGE: "1" },
});
