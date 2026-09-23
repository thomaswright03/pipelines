// Routes an agent/broker whose email channel didn't pan out (no email
// found after checking their guessed website) to phone outreach instead —
// same split as vault-phase-two.ts, applied to AgentLead.
import type { PrismaClient } from "@/generated/prisma/client";

export async function routeAgentToPhase2(
  prisma: PrismaClient,
  lead: { id: string; phone: string | null },
): Promise<{ status: "cold_call_list" | "contactless_list" }> {
  const status = lead.phone ? "cold_call_list" : "contactless_list";
  await prisma.agentLead.update({ where: { id: lead.id }, data: { status } });
  return { status };
}
