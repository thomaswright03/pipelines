// The Room Designer 3D pitch's switches, so changing one is a one-line edit:
//
// - SENDING_HELD: while true, no Room Designer email goes out from any path
//   (single, bulk, daily run); the daily run still finds remodelers. Ships
//   on (held) until Thomas says go; set it to false to start sending.
// - BRAND / PHONE: the signature (Thomas handles replies and calls).
// - SITE_URL: the page the pitch links to.
//
// Split out from the template so client and server code can read these
// without pulling in the template.

/** No Room Designer email is sent while this is true (see send.ts). */
export const ROOM_DESIGNER_SENDING_HELD = true;

/** Why sends are held, shown wherever a send is refused or disabled. */
export const ROOM_DESIGNER_HOLD_MESSAGE =
  "Room Designer 3D sending is off until Thomas turns it on. Remodelers are still found and saved; nothing is emailed.";

/** The company in the signature and on the dashboard card. */
export const ROOM_DESIGNER_BRAND = "Wright AI Solutions, LLC";
/** The number in the signature: Thomas's own (decided 2026-10-19). */
export const ROOM_DESIGNER_PHONE = "(801) 580-8630";
/** The home page: the one-minute video, live demo, pricing and the free-week sign-up. */
export const ROOM_DESIGNER_SITE_URL = "https://restoration-ai-website-nu.vercel.app";
/** The sign-up page alone, for whoever handles replies to send after a walkthrough. */
export const ROOM_DESIGNER_SIGNUP_URL = "https://restoration-ai-website-nu.vercel.app/signup.html";

/** Thomas's client: never named in the pitch and never emailed. */
export const ROOM_DESIGNER_CLIENT = "Eddys Remodeling";

// The address this pipeline's outreach is sent "from" via ZeptoMail (see
// send-email.ts) — must be a verified sender for wright-ai-solutions.com.
// Override with ROOM_DESIGNER_SENDER_EMAIL.
export const ROOM_DESIGNER_SENDER_EMAIL = process.env.ROOM_DESIGNER_SENDER_EMAIL ?? "thomas@wright-ai-solutions.com";

/** The Yelp search term for each city. */
export const ROOM_DESIGNER_YELP_TERM = "bathroom remodeling";
