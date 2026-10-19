// The address outreach is sent "from" via ZeptoMail (see send-email.ts) —
// must be a sender address configured and verified for
// wright-ai-solutions.com in ZeptoMail's dashboard. Override with
// DATALEADSELL_SENDER_EMAIL if it should send from a different address.
//
// Split out from actions/dataleadsell.ts: a "use server" file may only
// export async functions, not plain constants.
export const DATALEADSELL_SENDER_EMAIL = process.env.DATALEADSELL_SENDER_EMAIL ?? "thomas@wright-ai-solutions.com";

// Who the dataleadsell pitch is signed by (src/lib/dataleadsell-email-template.ts).
export const DATALEADSELL_SIGNER = "Thomas Wright";
export const DATALEADSELL_PHONE = "(801) 580-8630";
// Shown before the phone number ("Brokerage | Phone"); left out when empty.
export const DATALEADSELL_BROKERAGE = "";
// The sender named next to the postal address in the footer.
export const DATALEADSELL_BUSINESS_NAME = "Wright AI Solutions, LLC";
// "<County> County is still open." Set a county to "filling up" once it is
// close to taken; counties not listed read "still open".
export const DATALEADSELL_COUNTY_STATUS: Record<string, string> = {
  Maricopa: "still open",
  "Salt Lake": "still open",
  Utah: "still open",
};
