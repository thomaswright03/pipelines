// The Room Designer 3D pitch to bathroom remodelers. Used for every send and
// for the preview on each remodeler's page. CAN-SPAM requires the physical
// mailing address and the opt-out line.
//
// The prices here must match the live site (site-config.json "plans" in
// thomaswright03/Restoration-AI-Website). The template version changes on
// its own whenever this text does (email-template-version.ts).
import { OUTREACH_MAILING_ADDRESS } from "@/lib/outreach-mailing-address";
import { templateVersion } from "@/lib/email-template-version";
import { haulerGreetingName } from "@/lib/garbage-ai-email-template";
import { ROOM_DESIGNER_BRAND, ROOM_DESIGNER_PHONE, ROOM_DESIGNER_SITE_URL } from "@/lib/room-designer-config";

type PitchOptions = {
  siteUrl?: string;
  brand?: string;
  phone?: string;
};

/**
 * The first name to greet a remodeler by: the business list only gives the business name,
 * so a name is used only when the lead has a separate company and its own
 * name reads as a person's; otherwise "there".
 */
export const remodelerGreetingName = haulerGreetingName;

// Thomas's wording (intake form, 2026-10-19), word for word.
export function buildRemodelerOutreachEmail(
  lead: { name: string; company: string | null },
  options: PitchOptions = {},
): { subject: string; body: string } {
  const siteUrl = options.siteUrl ?? ROOM_DESIGNER_SITE_URL;
  const brand = options.brand ?? ROOM_DESIGNER_BRAND;
  const phone = options.phone ?? ROOM_DESIGNER_PHONE;
  const company = lead.company?.trim() || lead.name.trim();

  const subject = `show your customers their new bathroom in 3D`;
  const body = [
    `Hey ${remodelerGreetingName(lead.name, lead.company) ?? "there"},`,
    ``,
    `I'm Thomas. I built Room Designer 3D for bathroom remodelers like ${company}.`,
    ``,
    `You sit down with a customer, enter the room's size, and lay out the bathroom in 3D together, with real toilets, tubs, vanities, tile and paint. It checks clearances as you go and gives a rough estimate at your own labor prices, with a PDF and a materials list you can hand them. It works on a phone or tablet, in English, Spanish or Portuguese.`,
    ``,
    `Your first 7 days are free, no card needed. After that it's $49.99 a month, and you can cancel any time.`,
    ``,
    `There's a one-minute video and a live demo here: ${siteUrl}`,
    ``,
    `Happy to walk you through it on a quick call if that's easier.`,
    ``,
    `Thanks,`,
    `Thomas Wright`,
    phone,
    brand,
    OUTREACH_MAILING_ADDRESS,
    `If this isn't for you, just reply "no thanks" and I won't email again.`,
  ].join("\n");
  return { subject, body };
}

/** Which wording a send used (stored with it); changes whenever the template's text or its settings do. */
export const ROOM_DESIGNER_TEMPLATE_VERSION = templateVersion("room-designer", [
  buildRemodelerOutreachEmail({ name: "{remodeler}", company: null }),
  buildRemodelerOutreachEmail({ name: "Jane Doe", company: "{remodeler}" }),
]);
