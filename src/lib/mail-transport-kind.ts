// Which mail transport this process uses (see send-email.ts). Kept apart
// from send-email.ts so startup checks and page chrome can read it without
// loading nodemailer.
export type TransportKind = "zeptomail" | "smtp" | "outbox";
export type Env = Record<string, string | undefined>;

export function resolveTransportKind(env: Env = process.env): TransportKind {
  const configured = env.EMAIL_TRANSPORT?.trim().toLowerCase();
  if (configured === "zeptomail" || configured === "smtp" || configured === "outbox") return configured;
  return env.VERCEL ? "zeptomail" : "outbox";
}
