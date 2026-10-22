// Runs once when a server instance starts (including each Vercel cold
// start): fail loudly, naming what's missing, instead of letting a missing
// variable surface later as a cryptic error deep inside Prisma or
// nodemailer. See .env.example for what each variable is for.
import { resolveTransportKind, type Env } from "@/lib/mail-transport-kind";
import { muteClientDisconnectLogs } from "@/lib/client-disconnect-log";

export function missingEnvVars(env: Env = process.env): string[] {
  const required = ["PIPELINES_DATABASE_URL"];
  const transport = resolveTransportKind(env);
  if (transport === "zeptomail") required.push("ZEPTOMAIL_SMTP_PASSWORD");
  if (transport === "smtp") required.push("SMTP_HOST");
  // A deployment must be able to discover leads and authenticate its
  // webhooks; a local checkout can run without them (the features that need
  // them say so when used).
  if (env.VERCEL) required.push("EMAIL_INBOUND_SECRET", "CRON_SECRET");
  return required.filter((name) => !env[name]);
}

export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const missing = missingEnvVars();
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(", ")}. See .env.example for what each one is for.`);
  }
  console.info(`[startup] email transport: ${resolveTransportKind()}`);
  muteClientDisconnectLogs();
}
