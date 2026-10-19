// The Garbage AI pitch to waste haulers. Used for every send and for the
// preview on each hauler's page. CAN-SPAM requires the physical mailing
// address and the opt-out line.
import { OUTREACH_MAILING_ADDRESS } from "@/lib/outreach-mailing-address";
import { templateVersion } from "@/lib/email-template-version";
import { greetingName } from "@/lib/dataleadsell-email-template";
import { GARBAGE_AI_BRAND, GARBAGE_AI_PHONE, GARBAGE_AI_SIGNUP_URL } from "@/lib/garbage-ai-config";

type PitchOptions = {
  signupUrl?: string;
  brand?: string;
  phone?: string;
};

/**
 * The first name to greet a hauler by. Yelp only gives the business name, so
 * a name is used only when the lead has a separate company and its own name
 * reads as a person's; otherwise "there".
 */
export function haulerGreetingName(name: string, company: string | null): string | null {
  if (!company?.trim() || name.trim().toLowerCase() === company.trim().toLowerCase()) return null;
  return greetingName(name);
}

// Thomas's wording (2026-10-19), word for word.
export function buildHaulerOutreachEmail(
  lead: { name: string; company: string | null },
  options: PitchOptions = {},
): { subject: string; body: string } {
  const signupUrl = options.signupUrl ?? GARBAGE_AI_SIGNUP_URL;
  const brand = options.brand ?? GARBAGE_AI_BRAND;
  const phone = options.phone ?? GARBAGE_AI_PHONE;
  const company = lead.company?.trim() || lead.name.trim();

  const subject = `quick question about your leads`;
  const body = [
    `Hey ${haulerGreetingName(lead.name, lead.company) ?? "there"},`,
    ``,
    `Thomas here. I'll keep this short.`,
    ``,
    `I've been building something for trash haulers and wanted to see if it'd be useful to you guys at ${company}.`,
    ``,
    `It's basically an AI that texts your leads back for you. Someone texts asking if you pick up on their street, and it answers using your actual prices and policies. It figures out what they need, gets them to confirm, and can even set up the service agreement. If it's something a person should handle, like a billing issue or someone who wants to talk to a human, it hands it off to your team.`,
    ``,
    `I built it because I kept seeing haulers lose people who reached out on a Saturday night and didn't hear back until Monday. By then they'd already called someone else.`,
    ``,
    `It doesn't go live until you've seen how it talks to your customers and you're happy with it. And there's no commitment just to check it out.`,
    ``,
    `If you're curious, there's a short video and a signup form here: ${signupUrl}`,
    ``,
    `Or just reply and I'll walk you through it. Takes about 15 minutes.`,
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
export const GARBAGE_AI_TEMPLATE_VERSION = templateVersion("garbage-ai", [
  buildHaulerOutreachEmail({ name: "{hauler}", company: null }),
  buildHaulerOutreachEmail({ name: "Jane Doe", company: "{hauler}" }),
]);
