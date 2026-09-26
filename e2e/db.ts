// Direct database access for the browser tests: reset between tests and
// seed leads without going through the UI. Only ever points at a local or
// CI database (checked in global-setup.ts).
import { Client } from "pg";

export const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgresql://ci:ci@localhost:5432/pipelines_e2e";

export async function withDb<T>(fn: (db: Client) => Promise<T>, url = E2E_DATABASE_URL): Promise<T> {
  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

export async function resetDb(): Promise<void> {
  await withDb(async (db) => {
    const { rows } = await db.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
    );
    if (rows.length > 0) {
      await db.query(`TRUNCATE TABLE ${rows.map((r) => `"public"."${r.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
    }
  });
}

/** Inserts New Cold Outreach leads with addresses; returns their ids in creation order. */
export async function seedColdLeads(
  count: number,
  overrides: { name?: (i: number) => string; status?: string; phone?: string | null } = {},
): Promise<string[]> {
  return withDb(async (db) => {
    const ids: string[] = [];
    for (let i = 1; i <= count; i++) {
      const id = `e2e-lead-${i}`;
      await db.query(
        `INSERT INTO "Lead" (id, name, email, phone, city, state, status, source, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, 'Phoenix', 'AZ', $5, 'Browser test', now() - make_interval(secs => $6), now())`,
        [
          id,
          overrides.name?.(i) ?? `Test Business ${i}`,
          `owner${i}@business${i}.test`,
          overrides.phone === undefined ? "(480) 555-0100" : overrides.phone,
          overrides.status ?? "new",
          count - i,
        ],
      );
      ids.push(id);
    }
    return ids;
  });
}

export async function leadStatus(id: string): Promise<string | null> {
  return withDb(
    async (db) => (await db.query<{ status: string }>(`SELECT status FROM "Lead" WHERE id = $1`, [id])).rows[0]?.status ?? null,
  );
}

export async function count(sql: string): Promise<number> {
  return withDb(async (db) => Number((await db.query<{ n: string }>(sql)).rows[0]?.n ?? 0));
}

/** Inserts one New dataleadsell agent with an address; returns its id. */
export async function seedAgentLead(name = "Test Agent"): Promise<string> {
  return withDb(async (db) => {
    const id = "e2e-agent-1";
    await db.query(
      `INSERT INTO "AgentLead" (id, name, email, phone, city, county, state, status, source, "createdAt", "updatedAt")
       VALUES ($1, $2, 'agent1@realty1.test', '(602) 555-0100', 'Phoenix', 'Maricopa', 'AZ', 'new', 'Browser test', now(), now())`,
      [id, name],
    );
    return id;
  });
}
