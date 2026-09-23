// Runs once when a server instance starts (including each Vercel
// serverless cold start) — the right place to fail loudly with a clear
// message instead of letting a missing var surface later as a cryptic
// crash deep inside Prisma/nodemailer/etc. See .env.example for what each
// of these is for.
const REQUIRED_ENV_VARS = [
  "PIPELINES_DATABASE_URL",
  "ZEPTOMAIL_SMTP_PASSWORD",
  "YELP_API_KEY",
  "EMAIL_INBOUND_SECRET",
  "CRON_SECRET",
] as const;

export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}. See .env.example for what each one is for.`,
    );
  }
}
