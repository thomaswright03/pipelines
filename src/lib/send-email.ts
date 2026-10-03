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
import { ENV_PAUSED_MESSAGE, OutboundDisabledError, outboundDisabledByEnvironment } from "@/lib/outbound-switch";

export type MailMessage = {
  from: string;
  to: string;
  subject: string;
  text: string;
  /** Where replies go: the sending address, whose inbox the reply-tracking Worker reads. */
  replyTo?: string;
  headers?: Record<string, string>;
};

/**
 * The subject of the unsubscribe email a recipient's mail client sends from
 * the List-Unsubscribe header. It lands on the reply inbox like any reply,
 * and the reply classifier reads a subject of just "unsubscribe" as an
 * opt-out (STOP_COMMANDS in reply-classifier.ts).
 */
const LIST_UNSUBSCRIBE_SUBJECT = "unsubscribe";

/** The List-Unsubscribe header for mail sent from `from` (RFC 2369): a mailto back to the reply inbox. */
function listUnsubscribeHeader(from: string): string {
  return `<mailto:${from}?subject=${LIST_UNSUBSCRIBE_SUBJECT}>`;
}
type MailTransport = {
  sendMail(message: MailMessage): Promise<{ messageId: string }>;
  /** Connects, upgrades to TLS and logs in without sending anything (SMTP transports). */
  verify?(): Promise<unknown>;
};

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
    async verify() {
      await mkdir(dir, { recursive: true });
    },
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

/**
 * "Test connection": for SMTP transports, connects, does STARTTLS and logs
 * in with the configured credentials, then disconnects — no message is
 * sent. Throws the transport's error (see classifyConnectionTestError).
 */
export async function verifyMailTransport(): Promise<void> {
  const transport = getTransport();
  if (transport.verify) await transport.verify();
}

/** A failed connection test, in plain words for Settings → Connections. */
export function describeConnectionTestError(err: unknown): string {
  if (err instanceof MailConfigError) {
    return "Email isn't set up on the server yet. Tell your developer the email password (the ZeptoMail SMTP token) is missing.";
  }
  const e = (err ?? {}) as SmtpishError;
  if (e.code === "EAUTH") {
    return "The email service turned down our login. Tell your developer the ZeptoMail SMTP password needs replacing.";
  }
  if (
    e.syscall === "connect" ||
    e.syscall === "getaddrinfo" ||
    e.code === "ETIMEDOUT" ||
    e.code === "ECONNECTION" ||
    e.code === "ESOCKET"
  ) {
    return "Couldn't reach the email service. Try again in a few minutes; if it keeps failing, tell your developer.";
  }
  if (e.code === "ETLS") return "The email service's secure connection failed. Tell your developer.";
  return "The email service answered with an error. Try again later; if it keeps failing, tell your developer.";
}

export async function sendOutreachEmail(from: string, to: string, subject: string, body: string): Promise<{ providerMessageId: string }> {
  // The environment's emergency stop, checked here too in case any path
  // reaches the transport without going through sendFirstTouch's check.
  if (outboundDisabledByEnvironment()) throw new OutboundDisabledError();
  // Replies go explicitly to the sending address (the inbox the reply
  // Worker reads), and mail clients can offer their own unsubscribe button,
  // which emails that inbox with the subject "unsubscribe".
  const info = await getTransport().sendMail({
    from,
    to,
    subject,
    text: body,
    replyTo: from,
    headers: { "List-Unsubscribe": listUnsubscribeHeader(from) },
  });
  // messageId is the locally generated Message-ID header. ZeptoMail's SMTP
  // relay doesn't hand back a tracking id of its own, so this is only a
  // unique reference for the send log, not something a bounce webhook
  // could be correlated against.
  return { providerMessageId: info.messageId };
}

/**
 * A reply the operator writes to someone who answered a pitch. It threads
 * under their message (In-Reply-To/References name its Message-ID, when the
 * reply Worker passed one on) and replies come back to the same inbox.
 */
export async function sendReplyEmail(
  from: string,
  to: string,
  subject: string,
  body: string,
  inReplyTo: string | null,
): Promise<{ providerMessageId: string }> {
  if (outboundDisabledByEnvironment()) throw new OutboundDisabledError();
  const headers: Record<string, string> = { "List-Unsubscribe": listUnsubscribeHeader(from) };
  if (inReplyTo) {
    headers["In-Reply-To"] = inReplyTo;
    headers["References"] = inReplyTo;
  }
  const info = await getTransport().sendMail({ from, to, subject, text: body, replyTo: from, headers });
  return { providerMessageId: info.messageId };
}

/**
 * The owner's own daily report (daily-report.ts): an internal message, not
 * outreach, so it carries no unsubscribe header. The environment's
 * emergency stop still applies, as it does to everything that reaches the
 * transport.
 */
export async function sendReportEmail(from: string, to: string, subject: string, body: string): Promise<{ providerMessageId: string }> {
  if (outboundDisabledByEnvironment()) throw new OutboundDisabledError();
  const info = await getTransport().sendMail({ from, to, subject, text: body });
  return { providerMessageId: info.messageId };
}

/** A configuration problem: nothing was sent. */
export class MailConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailConfigError";
  }
}

type SendFailure = {
  /**
   * "not_sent": the failure happened before the provider could have accepted
   * the message (couldn't connect, auth failed, recipient or message
   * rejected), so nothing went out.
   * "unknown": the connection dropped mid-conversation; the provider may
   * have accepted it, so it must not be retried automatically.
   */
  delivery: "not_sent" | "unknown";
  /**
   * "service": the email service itself failed (unreachable, login, TLS,
   * refused our message) — every send would fail the same way.
   * "recipient": the recipient's address was refused; other sends are fine.
   */
  scope: "service" | "recipient";
  /** For a recipient refusal: a 5xx (never retry) rather than a 4xx (may work later). */
  permanent: boolean;
  /** Plain-language message for the operator. */
  message: string;
};

type SmtpishError = Error & { code?: string; command?: string; responseCode?: number; response?: string; syscall?: string };

const SERVICE_NOT_SENT_CODES = new Set(["EAUTH", "EDNS", "ETLS", "ECONFIG", "EREQUIRETLS", "EMESSAGE"]);

// RFC 3463 enhanced status codes about the destination mailbox or address
// (5.1.x bad address/mailbox, 5.2.x mailbox disabled/unavailable) — a
// refusal of this recipient, even when it comes back at the DATA stage.
const MAILBOX_STATUS_RE = /\b[45]\.[12]\.\d{1,3}\b/;

/** The server's short reason ("550 5.1.1 User unknown"), for the operator. */
function serverReply(e: SmtpishError): string {
  const text = (e.response ?? "").replace(/\s+/g, " ").trim();
  return text ? ` The mail server said: "${text.slice(0, 160)}".` : "";
}

/** Classifies a transport error for the operator and the send ledger. */
export function classifySendError(err: unknown): SendFailure {
  const service = (message: string): SendFailure => ({ delivery: "not_sent", scope: "service", permanent: false, message });
  if (err instanceof OutboundDisabledError) return service(ENV_PAUSED_MESSAGE);
  if (err instanceof MailConfigError) {
    // The technical detail (which setting is missing) is in the server log.
    return service("Email sending isn't set up yet — nothing was sent. Ask your developer to finish the email setup.");
  }
  const e = (err ?? {}) as SmtpishError;
  const code = e.code ?? "";
  const unreachable =
    e.syscall === "connect" ||
    e.syscall === "getaddrinfo" ||
    (code === "ETIMEDOUT" && /Connection timeout|Greeting never received/i.test(e.message ?? ""));

  if (unreachable) return service("Couldn't reach the email service — nothing was sent. Try again in a few minutes.");
  if (code === "EAUTH") {
    return service("The email service rejected our login — nothing was sent. Ask your developer to check the email password.");
  }

  // The recipient was refused: at RCPT TO (nodemailer's EENVELOPE), or with
  // a mailbox status code at any stage. Nothing went out, and it's about
  // this one address — the service itself is working.
  // (A refusal of our own sender address at MAIL FROM is the service's.)
  const command = e.command ?? "";
  const recipientRefused =
    !/^MAIL\b/i.test(command) &&
    (code === "EENVELOPE" || /^RCPT/i.test(command) || MAILBOX_STATUS_RE.test(`${e.response ?? ""} ${e.message ?? ""}`));
  if (recipientRefused) {
    // A 4xx is temporary (mailbox full, greylisting); no code at all means
    // the address itself couldn't be used (nodemailer refused it).
    const permanent = !(e.responseCode && e.responseCode >= 400 && e.responseCode < 500);
    return {
      delivery: "not_sent",
      scope: "recipient",
      permanent,
      message: permanent
        ? `The recipient's mail server refused this address — nothing was sent.${serverReply(e)} Check the address or find a new one.`
        : `The recipient's mail server turned this address away for now — nothing was sent.${serverReply(e)}`,
    };
  }

  if (SERVICE_NOT_SENT_CODES.has(code) || (e.responseCode && e.responseCode >= 400)) {
    return service(
      "The email service refused this message — nothing was sent. Try again later; if it keeps happening, tell your developer.",
    );
  }
  return {
    delivery: "unknown",
    scope: "service",
    permanent: false,
    message:
      "The connection to the email service dropped mid-send, so we can't tell whether this email went out. " +
      "The lead is marked Contacted so it won't be pitched twice — check ZeptoMail's sent log before doing anything else.",
  };
}
