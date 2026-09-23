import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { routeLeadToPhase2 } from "@/lib/vault-phase-two";

// Replaces the stale-contact half of what checkReplies used to do by
// scanning Mail.app: a "contacted" lead that's heard nothing back in 7+
// days moves to phone outreach instead of waiting forever. This half never
// actually needed Mail.app — it's just a timestamp comparison — so it
// becomes a plain scheduled job instead of something tied to reading an
// inbox. Scheduled via vercel.json's crons (daily); Vercel signs the
// request with CRON_SECRET as a bearer token, which this checks so the
// endpoint can't be triggered by anyone who finds the URL.
const STALE_CONTACT_DAYS = 7;

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const cutoff = new Date(Date.now() - STALE_CONTACT_DAYS * 24 * 60 * 60 * 1000);
  const stale = await prisma.lead.findMany({
    where: { status: "contacted", lastEmailedAt: { lte: cutoff } },
  });

  let routed = 0;
  for (const lead of stale) {
    await routeLeadToPhase2(prisma, lead);
    routed += 1;
  }

  return Response.json({ checked: stale.length, routed });
}
