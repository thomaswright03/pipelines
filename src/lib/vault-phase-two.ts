// Routes a lead whose email channel didn't work out (no email found, no
// response within a week, or only an automated response) to phone
// outreach instead. Used to also try a Selenium-based phone lookup when a
// lead had no number on record — dropped along with the rest of the
// Selenium scraping (see email-finder.ts); Yelp already supplies a phone
// number for most leads at discovery time, so a lead that still has none
// here genuinely has none, and goes to the contactless list.
import type { PrismaClient } from "@/generated/prisma/client";

export async function routeLeadToPhase2(
  prisma: PrismaClient,
  lead: { id: string; phone: string | null },
): Promise<{ status: "cold_call_list" | "contactless_list" }> {
  const status = lead.phone ? "cold_call_list" : "contactless_list";
  await prisma.lead.update({ where: { id: lead.id }, data: { status } });
  return { status };
}
