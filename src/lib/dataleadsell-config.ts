// The address outreach is sent "from" via ZeptoMail (see send-email.ts) —
// must be a sender address configured and verified for
// wright-ai-solutions.com in ZeptoMail's dashboard. Override with
// DATALEADSELL_SENDER_EMAIL if it should send from a different address.
//
// Split out from actions/dataleadsell.ts: a "use server" file may only
// export async functions, not plain constants.
export const DATALEADSELL_SENDER_EMAIL = process.env.DATALEADSELL_SENDER_EMAIL ?? "thomas@wright-ai-solutions.com";
