// The Garbage AI pitch's switches, so changing one is a one-line edit:
//
// - SENDING_HELD: while true, no Garbage AI email goes out from any path
//   (single, bulk, daily run); the daily run still finds haulers. Off
//   since Thomas said go on 2026-09-28; set it back to true to stop sends.
// - BRAND / PHONE: the signature.
// - SIGNUP_URL: the video and signup form the pitch links to.
//
// Split out from the template so client and server code can read these
// without pulling in the template.

/** No Garbage AI email is sent while this is true (see send.ts). */
export const GARBAGE_AI_SENDING_HELD = false;

/** Why sends are held, shown wherever a send is refused or disabled. */
export const GARBAGE_AI_HOLD_MESSAGE =
  "Garbage AI sending is off until Thomas turns it on. Haulers are still found and saved; nothing is emailed.";

/** The current client the pitch never emails (and whose Colorado area it skips). */
export const GARBAGE_AI_REFERENCE_CUSTOMER = "Mountain High Disposal";

/** The company in the signature and on the dashboard card (decided 2026-09-28). */
export const GARBAGE_AI_BRAND = "Wright AI Solutions, LLC";
/** The number in the signature: Max Garrett's, since he makes the follow-up calls. */
export const GARBAGE_AI_PHONE = "(385) 306-8041";
/** Who runs the demo. */
export const GARBAGE_AI_DEMO_HOST = "Max Garrett";
/** The hauler signup site (short video + signup form) the pitch links to. */
export const GARBAGE_AI_SIGNUP_URL = "https://hauler-signup.vercel.app";

// The address this pipeline's outreach is sent "from" via ZeptoMail (see
// send-email.ts) — must be a verified sender for wright-ai-solutions.com.
// Override with GARBAGE_AI_SENDER_EMAIL.
export const GARBAGE_AI_SENDER_EMAIL = process.env.GARBAGE_AI_SENDER_EMAIL ?? "thomas@wright-ai-solutions.com";

/** The Yelp search term for each city. "dumpster rental" is a possible second term later. */
export const GARBAGE_AI_YELP_TERM = "garbage collection";
