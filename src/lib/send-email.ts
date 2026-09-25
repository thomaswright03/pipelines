// Delivers outreach email. Three transports, picked by EMAIL_TRANSPORT:
//
// - "zeptomail": ZeptoMail's SMTP relay (smtp.zeptomail.com:587, STARTTLS).
//   The username is always the literal "emailapikey"; the password is the
//   domain's SMTP token from ZeptoMail's Mail Agent > Setup > SMTP page.
//   This is the default on Vercel (where VERCEL is set).
// - "smtp": any SMTP server at SMTP_HOST:SMTP_PORT — e.g. a local mail
//   catcher such as Mailpit, to watch sends during development.
// - "outbox": nothing leaves the machine; each message is written as an
//   .eml file under OUTBOX_DIR (default ./.outbox). This is the default
//   everywhere except Vercel, so a local checkout can never email a real
//   prospect by accident.
//
// Timeouts are short on purpose: a function on Vercel has 60 s in total,
// so a mail-provider outage must fail a send in seconds, not minutes.
import nodemailer from "nodemailer";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveTransportKind, type TransportKind } from "@/lib/mail-transport-kind";

export type MailMessage = { from: string; to: string; subject: string; text: string };
export type MailTransport = { sendMail(message: MailMessage): Promise<{ messageId: string }> };

const CONNECTION_TIMEOUT_MS = 5_000;
const GREETING_TIMEOUT_MS = 5_000;
const SOCKET_TIMEOUT_MS = 10_000;

function createSmtpTransport(kind: "zeptomail" | "smtp"): MailTransport {
  if (kind === "zeptomail") {
    const password = process.env.ZEPTOMAIL_SMTP_PASSWORD;
    if (!password) {
      throw new MailConfigError("ZEPTOMAIL_SMTP_PASSWORD isn't set, so outreach email can't be sent.");
    }
    return nodemailer.createTransport({
      host: "smtp.zeptomail.com",
      port: 587,
      secure: false, // STARTTLS on 587, not implicit TLS
      auth: { user: process.env.ZEPTOMAIL_SMTP_USER || "emailapikey", pass: password },
      connectionTimeout: CONNECTION_TIMEOUT_MS,
      greetingTimeout: GREETING_TIMEOUT_MS,
      socketTimeout: SOCKET_TIMEOUT_MS,
    });
  }
  const host = process.env.SMTP_HOST;
  if (!host) throw new MailConfigError("EMAIL_TRANSPORT=smtp needs SMTP_HOST (and usually SMTP_PORT).");
  const user = process.env.SMTP_USER;
  return nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 1025),
    secure: false,
    auth: user ? { user, pass: process.env.SMTP_PASSWORD ?? "" } : undefined,
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
  });
}

function createOutboxTransport(): MailTransport {
  const stream = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
  // Local development only (never used on Vercel), so keep it out of output tracing.
  const dir = path.resolve(/*turbopackIgnore: true*/ process.env.OUTBOX_DIR || ".outbox");
  return {
    async sendMail(message) {
      const info = await stream.sendMail(message);
      await mkdir(dir, { recursive: true });
      const safeTo = message.to.replace(/[^a-z0-9@._-]/gi, "_");
      const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}_${safeTo}.eml`);
      await writeFile(file, info.message as Buffer);
      console.info(`[send-email] captured (not delivered): to=${message.to} file=${file}`);
      return { messageId: info.messageId };
    },
  };
}

let cachedTransport: { kind: TransportKind; transport: MailTransport } | null = null;
let testTransport: MailTransport | null = null;

/** Tests swap in a capturing transport; pass null to restore the real one. */
export function setMailTransportForTesting(transport: MailTransport | null): void {
  testTransport = transport;
}

function getTransport(): MailTransport {
  if (testTransport) return testTransport;
  const kind = resolveTransportKind();
  if (cachedTransport?.kind !== kind) {
    cachedTransport = { kind, transport: kind === "outbox" ? createOutboxTransport() : createSmtpTransport(kind) };
  }
  return cachedTransport.transport;
}

export async function sendOutreachEmail(
  from: string,
  to: string,
  subject: string,
  body: string,
): Promise<{ providerMessageId: string }> {
  const info = await getTransport().sendMail({ from, to, subject, text: body });
  // messageId is the locally generated Message-ID header. ZeptoMail's SMTP
  // relay doesn't hand back a tracking id of its own, so this is only a
  // unique reference for the send log, not something a bounce webhook
  // could be correlated against.
  return { providerMessageId: info.messageId };
}

/** A configuration problem: nothing was sent. */
export class MailConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailConfigError";
  }
}

export type SendFailure = {
  /**
   * "not_sent": the failure happened before the provider could have accepted
   * the message (couldn't connect, auth failed, recipient or message
   * rejected), so it is safe to try again later.
   * "unknown": the connection dropped mid-conversation; the provider may
   * have accepted it, so it must not be retried automatically.
   */
  delivery: "not_sent" | "unknown";
  /** Plain-language message for the operator. */
  message: string;
};

type SmtpishError = Error & { code?: string; command?: string; responseCode?: number; syscall?: string };

const NOT_SENT_CODES = new Set(["EAUTH", "EENVELOPE", "EDNS", "ETLS", "ECONFIG", "EREQUIRETLS", "EMESSAGE"]);

/** Classifies a transport error for the operator and the send ledger. */
export function classifySendError(err: unknown): SendFailure {
  if (err instanceof MailConfigError) {
    return { delivery: "not_sent", message: `Email isn't set up on this deployment — nothing was sent. ${err.message}` };
  }
  const e = (err ?? {}) as SmtpishError;
  const code = e.code ?? "";
  const unreachable =
    e.syscall === "connect" ||
    e.syscall === "getaddrinfo" ||
    (code === "ETIMEDOUT" && /Connection timeout|Greeting never received/i.test(e.message ?? ""));

  if (unreachable) {
    return {
      delivery: "not_sent",
      message: "Couldn't reach the email service — nothing was sent. Try again in a few minutes.",
    };
  }
  if (code === "EAUTH") {
    return {
      delivery: "not_sent",
      message: "The email service rejected our login — nothing was sent. The SMTP password needs checking.",
    };
  }
  if (NOT_SENT_CODES.has(code) || (e.responseCode && e.responseCode >= 400)) {
    return {
      delivery: "not_sent",
      message: "The email service refused this message — nothing was sent. Check the address, or try again later.",
    };
  }
  return {
    delivery: "unknown",
    message:
      "The connection to the email service dropped mid-send, so we can't tell whether this email went out. " +
      "The lead is marked Contacted so it won't be pitched twice — check ZeptoMail's sent log before doing anything else.",
  };
}
