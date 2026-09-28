// The Garbage AI pitch to waste haulers. Used for every send and for the
// preview on each hauler's page. CAN-SPAM requires the physical mailing
// address and the opt-out line. No prices and no results figures: pricing
// is covered on the demo, and no current number is confirmed yet.
import { OUTREACH_MAILING_ADDRESS } from "@/lib/outreach-mailing-address";
import { templateVersion } from "@/lib/email-template-version";
import { greetingName } from "@/lib/dataleadsell-email-template";
import {
  GARBAGE_AI_BRAND,
  GARBAGE_AI_DEMO_HOST,
  GARBAGE_AI_NAME_REFERENCE_CUSTOMER,
  GARBAGE_AI_PHONE,
  GARBAGE_AI_REFERENCE_CUSTOMER,
  GARBAGE_AI_SIGNUP_URL,
} from "@/lib/garbage-ai-config";

type PitchOptions = {
  nameReferenceCustomer?: boolean;
  signupUrl?: string | null;
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

export function buildHaulerOutreachEmail(
  lead: { name: string; company: string | null },
  options: PitchOptions = {},
): { subject: string; body: string } {
  const named = options.nameReferenceCustomer ?? GARBAGE_AI_NAME_REFERENCE_CUSTOMER;
  const signupUrl = options.signupUrl === undefined ? GARBAGE_AI_SIGNUP_URL : options.signupUrl;
  const brand = options.brand ?? GARBAGE_AI_BRAND;
  const phone = options.phone ?? GARBAGE_AI_PHONE;

  const subject = `Who's texting back your 9pm leads?`;
  const body = [
    `Hi ${haulerGreetingName(lead.name, lead.company) ?? "there"},`,
    ``,
    `A homeowner fills out your form at 9pm. By morning, they've signed with whoever texted back first.`,
    ``,
    `We built an AI that texts back every lead you get, day or night, in your company's own voice. It only quotes the prices and policies you've approved, answers questions, handles the usual objections, and gets the customer to sign off on the terms by text. Anything that needs a real person goes straight to your team.`,
    ``,
    `${named ? `${GARBAGE_AI_REFERENCE_CUSTOMER} in Colorado` : "A hauler in Colorado"} runs it today. Leads that used to go unanswered now turn into signed customers every week, with no new hires, and it even writes each contract into their back-office system on its own.`,
    ``,
    `Worth 15 minutes to see it live? ${GARBAGE_AI_DEMO_HOST}, who runs it with ${named ? "Mountain High" : "them"}, will walk you through it. Just reply with a time that works.`,
    ...(signupUrl ? [``, `Or take a look first: ${signupUrl}`] : []),
    ``,
    `Thomas Wright`,
    phone,
    brand,
    OUTREACH_MAILING_ADDRESS,
    ...(signupUrl ? [signupUrl] : []),
    ``,
    `Don't want to hear from us again? Reply STOP and we won't email you again.`,
  ].join("\n");
  return { subject, body };
}

/** Which wording a send used (stored with it); changes whenever the template's text or its settings do. */
export const GARBAGE_AI_TEMPLATE_VERSION = templateVersion("garbage-ai", [
  buildHaulerOutreachEmail({ name: "{hauler}", company: null }),
  buildHaulerOutreachEmail({ name: "Jane Doe", company: "{hauler}" }),
]);
