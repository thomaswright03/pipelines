// docs/deployment.md's owner-only setup lists the migrations to apply
// before deploying. An owner who follows the list rather than the command
// must not miss one, so every migration from the first one listed on must
// be named there.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const doc = readFileSync(path.join(root, "docs/deployment.md"), "utf8");
const ownerSetup = doc.slice(doc.indexOf("## Owner-only setup"));
const migrations = readdirSync(path.join(root, "prisma/migrations"), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

describe("docs/deployment.md owner-only setup", () => {
  it("names every migration from the first one it lists to the newest", () => {
    const listed = migrations.filter((m) => ownerSetup.includes(`\`${m}\``));
    expect(listed.length).toBeGreaterThan(0);
    const unlisted = migrations.filter((m) => m > listed[0]! && !listed.includes(m));
    expect(unlisted).toEqual([]);
    expect(listed).toContain(migrations.at(-1));
  });

  it("gives the command that shows which migrations are pending", () => {
    expect(ownerSetup).toContain("npx prisma migrate status");
  });
});
