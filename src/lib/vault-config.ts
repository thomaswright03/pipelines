// The address this pipeline's outreach is sent "from" via ZeptoMail (see
// send-email.ts) — must be a sender address configured and verified for
// wright-ai-solutions.com in ZeptoMail's dashboard. Same business identity
// Vault (bizhub) itself uses — this pipeline is a copy of Vault's own
// client-acquisition outreach. Override with VAULT_PIPELINE_SENDER_EMAIL if
// this should send from a different address.
export const VAULT_PIPELINE_SENDER_EMAIL = process.env.VAULT_PIPELINE_SENDER_EMAIL ?? "thomas@wright-ai-solutions.com";
