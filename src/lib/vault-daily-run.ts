// The daily automated Cold Outreach run: scrape one city's worth of
// businesses (capped at a configurable count), keep only the ones an email
// was actually found for (same policy as every other discovery path — see
// dedupeAndCreate in actions/vault-pipeline.ts), then immediately send
// outreach to exactly those leads. Deliberately self-contained rather than
// reusing the "use server" actions file, since this runs unattended from a
// cron route, not from a client click.
import { prisma } from "@/lib/db";
import { findBusinessesViaYelp } from "@/lib/yelp-discovery";
import { guessWebsiteForBusiness } from "@/lib/website-finder";
import { findEmailForBusiness } from "@/lib/email-finder";
import { sendOutreachEmail } from "@/lib/send-email";
import { isSuppressed } from "@/lib/email-suppression";
import { buildOutreachEmail } from "@/lib/vault-email-template";
import { pickNextCity, markCityUsed } from "@/lib/vault-city-picker";
import { withRetry } from "@/lib/with-retry";
import { VAULT_PIPELINE_SENDER_EMAIL } from "@/lib/vault-config";

// Leaves headroom under Vercel Hobby's 60s function ceiling — an
// unattended run has no "click again" to finish the rest, so whatever
// doesn't fit in the budget just waits for tomorrow's city.
const DAILY_RUN_TIME_BUDGET_MS = 45 * 1000;
const DEFAULT_LEAD_COUNT = 30;

export type DailyRunResult = {
  city: string;
  state: string;
  scraped: number;
  created: number;
  sent: number;
  failed: number;
};

export async function runDailyColdOutreach(leadCount: number = DEFAULT_LEAD_COUNT): Promise<DailyRunResult> {
  const target = await withRetry(() => pickNextCity(prisma));

  const results = await findBusinessesViaYelp("", `${target.city}, ${target.state}`);
  const candidates = results.slice(0, leadCount);

  await withRetry(() => markCityUsed(prisma, target.city, target.state));

  const existingNames = new Set(
    (await prisma.lead.findMany({ select: { name: true } })).map((l) => l.name.trim().toLowerCase()),
  );

  const startedAt = Date.now();
  const createdIds: string[] = [];
  for (const c of candidates) {
    if (Date.now() - startedAt > DAILY_RUN_TIME_BUDGET_MS) break;
    const key = c.name.trim().toLowerCase();
    if (!c.name.trim() || existingNames.has(key)) continue;

    let website: string | null = null;
    let email: string | null = null;
    try {
      website = c.website ?? (await guessWebsiteForBusiness(c.name));
      email = await findEmailForBusiness(website);
    } catch {
      // no email found this run — skip, same policy as every other discovery path
    }
    if (!email) continue;

    existingNames.add(key);
    const lead = await prisma.lead.create({
      data: {
        name: c.name,
        phone: c.phone,
        address: c.address,
        website,
        email,
        city: target.city,
        state: target.state,
        source: "Yelp search (daily automated run)",
        status: "new",
        emailCheckedAt: new Date(),
      },
    });
    createdIds.push(lead.id);
  }

  let sent = 0;
  let failed = 0;
  for (const leadId of createdIds) {
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead?.email || (await isSuppressed(lead.email))) {
      failed++;
      continue;
    }
    try {
      const { subject, body } = buildOutreachEmail(lead.company || lead.name);
      const { providerMessageId } = await sendOutreachEmail(VAULT_PIPELINE_SENDER_EMAIL, lead.email, subject, body);
      await prisma.lead.update({ where: { id: leadId }, data: { lastEmailedAt: new Date(), status: "contacted" } });
      await prisma.leadEmailSendLog.create({ data: { leadId, email: lead.email, providerMessageId } });
      sent++;
    } catch {
      failed++;
    }
  }

  return { city: target.city, state: target.state, scraped: candidates.length, created: createdIds.length, sent, failed };
}
