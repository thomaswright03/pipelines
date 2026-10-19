// The database refuses a lead status the app doesn't know, and the UI names
// one that got in anyway instead of showing it raw.
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { COLD_OUTREACH_STATUSES, DATALEADSELL_STATUSES, ROOM_DESIGNER_STATUSES, statusLabel } from "@/lib/lead-status";
import { makeAgentLead, makeColdLead } from "./helpers";

async function allowedByDatabase(constraint: string): Promise<string[]> {
  const [row] = await prisma.$queryRaw<{ def: string }[]>`
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ${constraint}`;
  return [...(row?.def ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!).sort();
}

describe("lead status in the database", () => {
  it("allows exactly the statuses each pipeline knows", async () => {
    expect(await allowedByDatabase("Lead_status_check")).toEqual([...COLD_OUTREACH_STATUSES].sort());
    expect(await allowedByDatabase("AgentLead_status_check")).toEqual([...DATALEADSELL_STATUSES].sort());
    expect(await allowedByDatabase("RemodelerLead_status_check")).toEqual([...ROOM_DESIGNER_STATUSES].sort());
  });

  it("rejects an unknown status", async () => {
    const cold = await makeColdLead();
    const agent = await makeAgentLead();
    await expect(prisma.$executeRaw`UPDATE "Lead" SET status = 'bogus' WHERE id = ${cold.id}`).rejects.toThrow(/Lead_status_check/);
    await expect(prisma.$executeRaw`UPDATE "AgentLead" SET status = 'paying_client' WHERE id = ${agent.id}`).rejects.toThrow(
      /AgentLead_status_check/,
    );
  });

  it("an unknown status is labelled as unknown, not shown raw", () => {
    expect(statusLabel("cold_call")).toBe("Unknown status (cold_call)");
    expect(statusLabel("toString")).toBe("Unknown status (toString)");
    expect(statusLabel("lost")).toBe("Lost");
  });
});
