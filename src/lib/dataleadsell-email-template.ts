// Outreach copy for the dataleadsell.com pipeline — pitching a Probate
// Property Leads subscription to real estate agents. Used for every send
// (single, bulk) and for the preview on each agent's page.

// CAN-SPAM requires a valid physical postal address on commercial email —
// same address Wright AI Solutions, LLC (dataleadsell.com's owner) uses on
// Vault's outreach.
const OUTREACH_MAILING_ADDRESS = "28 E 14 Street, Tempe, AZ 85281";

const COUNTY_PRICING: Record<string, string> = {
  Maricopa: "$500/mo",
  "Salt Lake": "$300/mo",
  Utah: "$175/mo",
};

export function buildAgentOutreachEmail(
  agentName: string,
  county: string | null,
): { subject: string; body: string } {
  const countyLabel = county ? `${county} County` : "your county";
  const price = county ? COUNTY_PRICING[county] : undefined;
  const priceLine = price ? ` — ${price} for ${countyLabel}` : "";

  const subject = `Probate leads in ${countyLabel} before your competitors see them`;

  const body = [
    `Hi ${agentName || "there"},`,
    ``,
    `I run Data Lead Sell — we track new probate filings in ${countyLabel}, cross-check the property owner's name against the deceased's obituary to confirm it's a real, sellable lead, and hand you a list of verified probate property leads every week, plus optional pre-designed letters mailed straight to the heirs.`,
    ``,
    `These are motivated sellers most agents never hear about until a wholesaler or another agent already has the listing.`,
    ``,
    `Access is a monthly subscription by county${priceLine}, no long-term contract — cancel anytime.`,
    ``,
    `Take a look at dataleadsell.com and see this week's confirmed leads for ${countyLabel}. Happy to answer any questions — just reply to this email.`,
    ``,
    `Thomas Wright`,
    `(801) 580-8630`,
    `Data Lead Sell — Wright AI Solutions, LLC`,
    `${OUTREACH_MAILING_ADDRESS}`,
    `dataleadsell.com`,
    ``,
    `Don't want to hear from us again? Reply STOP and we won't email you again.`,
  ].join("\n");

  return { subject, body };
}
