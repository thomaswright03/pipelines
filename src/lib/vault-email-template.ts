// The Cold Outreach pitch (same copy as The Vault's own outreach). Used for
// every send — single, bulk, the daily cron — and the preview on each lead's
// page. CAN-SPAM requires the physical mailing address and the opt-out line.
import { OUTREACH_MAILING_ADDRESS } from "@/lib/outreach-mailing-address";
import { templateVersion } from "@/lib/email-template-version";

/** Where the pitch sends people to describe what they want built. */
const START_URL = "https://wright-ai-solutions.com/start";

export function buildOutreachEmail(businessName: string): { subject: string; body: string } {
  const subject = `I probably shouldn’t have sent this 😂`;
  const body = [
    `Hey there,`,
    ``,
    `I came across ${businessName} and spent a few minutes looking at your business.`,
    ``,
    `I’m a software developer, and I build websites, AI, automations, and custom software for businesses.`,
    ``,
    `But I don't really have a list of "packages" I try to sell everyone.`,
    ``,
    `I figure out what a business actually needs, then build it.`,
    ``,
    `Maybe you need a better website.`,
    ``,
    `Maybe there's something in your business that takes your employees hours every week that could be automated.`,
    ``,
    `Maybe you have an idea you've wanted built but haven't found someone who can actually make it.`,
    ``,
    `That's where I come in.`,
    ``,
    `If there's something you've been wanting to improve, automate, or build, tell me about it here:`,
    ``,
    `${START_URL}`,
    ``,
    `I'll take a look and let you know what I think I could do.`,
    ``,
    `No sales pitch. No cookie-cutter package.`,
    ``,
    `You tell me the problem. I'll figure out the solution.`,
    ``,
    `(Rather talk it through? Just reply to this email or give me a call. Or fill out the form on my website)`,
    ``,
    `Thomas Wright`,
    `(801)580-8630`,
    `Wright AI Solutions, LLC`,
    `${OUTREACH_MAILING_ADDRESS}`,
    ``,
    `P.S. I work with businesses that already have a website, businesses that don't, and businesses that need something way beyond a website.`,
    ``,
    `Don't want to hear from us again? Reply STOP and we won't email you again.`,
  ].join("\n");
  return { subject, body };
}

/** Which wording a send used (stored with it); changes whenever the template's text does. */
export const COLD_OUTREACH_TEMPLATE_VERSION = templateVersion("cold-outreach", [buildOutreachEmail("{business}")]);
