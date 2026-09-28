// Everything about the Garbage AI pitch that is still waiting on a decision
// lives here, so changing it is a one-line edit:
//
// - SENDING_HELD: while true, no Garbage AI email goes out from any path
//   (single, bulk, daily run). The daily run still finds haulers. Turn it
//   off only once Mountain High's naming OK, the brand and the signup URL
//   are settled.
// - NAME_REFERENCE_CUSTOMER: whether the pitch names Mountain High Disposal.
//   If they say no, set it to false and the email says "A hauler in
//   Colorado" instead.
// - BRAND / PHONE / SIGNUP_URL: the signature. The "Or take a look first"
//   line and the signature URL only appear once SIGNUP_URL is set.
//
// Split out from the template so client and server code can read these
// without pulling in the template.

/** No Garbage AI email is sent while this is true (see send.ts). */
export const GARBAGE_AI_SENDING_HELD = true;

/** Why sends are held, shown wherever a send is refused or disabled. */
export const GARBAGE_AI_HOLD_MESSAGE =
  "Garbage AI sending is on hold until Mountain High's OK to be named, the brand and the signup link are settled. Haulers are still found and saved; nothing is emailed.";

/** Whether the pitch names the reference customer (needs their OK). */
export const GARBAGE_AI_NAME_REFERENCE_CUSTOMER = true;
export const GARBAGE_AI_REFERENCE_CUSTOMER = "Mountain High Disposal";

/** The company in the signature and on the dashboard card (Wright AI Solutions or Kaizen Marketing: undecided). */
export const GARBAGE_AI_BRAND = "Wright AI Solutions, LLC";
/** The number in the signature and the call deck. */
export const GARBAGE_AI_PHONE = "(801) 580-8630";
/** Who runs the demo. */
export const GARBAGE_AI_DEMO_HOST = "Max Garrett";
/** The hauler signup site, once it is deployed (null until then). */
export const GARBAGE_AI_SIGNUP_URL: string | null = null;

// The address this pipeline's outreach is sent "from" via ZeptoMail (see
// send-email.ts) — must be a verified sender for wright-ai-solutions.com.
// Override with GARBAGE_AI_SENDER_EMAIL.
export const GARBAGE_AI_SENDER_EMAIL = process.env.GARBAGE_AI_SENDER_EMAIL ?? "thomas@wright-ai-solutions.com";

/** The Yelp search term for each city. "dumpster rental" is a possible second term later. */
export const GARBAGE_AI_YELP_TERM = "garbage collection";
