// Sends outreach via ZeptoMail's SMTP relay instead of driving macOS
// Mail.app, so outreach actually works from Vercel, not just this Mac.
// ZeptoMail's SMTP username is always the literal string "emailapikey" —
// the real per-account secret is the password (the transactional API
// token, not a personal password), from the domain's Mail Agent > Setup >
// SMTP page in ZeptoMail once wright-ai-solutions.com is verified there.
//
// Bounce detection previously ran off Resend's webhook. Swapping providers
// means there's no bounce webhook wired up yet — see the "Mark bounced"
// button on each lead as the honest, immediately-working fallback until
// ZeptoMail's own bounce webhook is confirmed and wired in (its payload
// shape needs to be checked against real ZeptoMail docs/a live event
// before trusting an implementation of it).
import nodemailer from "nodemailer";

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter(): ReturnType<typeof nodemailer.createTransport> {
  const password = process.env.ZEPTOMAIL_SMTP_PASSWORD;
  if (!password) {
    throw new Error("ZEPTOMAIL_SMTP_PASSWORD isn't set — outreach email can't be sent until it is.");
  }
  transporter ??= nodemailer.createTransport({
    host: "smtp.zeptomail.com",
    port: 587,
    secure: false, // STARTTLS on 587, not implicit TLS
    auth: {
      user: process.env.ZEPTOMAIL_SMTP_USER ?? "emailapikey",
      pass: password,
    },
  });
  return transporter;
}

export async function sendOutreachEmail(
  from: string,
  to: string,
  subject: string,
  body: string,
): Promise<{ providerMessageId: string }> {
  const info = await getTransporter().sendMail({ from, to, subject, text: body });

  // messageId is a locally-generated Message-ID header, not a ZeptoMail
  // tracking id (SMTP has no equivalent — unlike Resend's HTTP API, there's
  // no id ZeptoMail itself hands back here to correlate a future bounce
  // webhook against). Stored anyway so the send log at least has something
  // unique per send; bounce correlation uses email+time instead until the
  // webhook is wired up (see the module comment above).
  return { providerMessageId: info.messageId };
}
