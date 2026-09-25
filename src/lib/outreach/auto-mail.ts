// Recognises inbound mail that no person wrote: automatic replies
// (out-of-office, vacation responders, "we got your message" autoresponders)
// and delivery-failure notices (bounces). Neither is a prospect replying:
//
// - An automatic reply is recorded in the lead's history, marked as
//   automatic, and changes nothing else — the lead keeps its status, gets
//   no reply time, isn't counted as replied, and still moves to phone
//   outreach after a week of silence.
// - A bounce marks the failed recipient's latest send as bounced, with the
//   same rules as the lead page's "Mark bounced" (see inbound.ts).
//
// Headers are the reliable signal (RFC 3834 `Auto-Submitted`, and the
// de-facto `X-Autoreply`, `X-Autorespond`, `Precedence`,
// `X-Auto-Response-Suppress`); the Cloudflare Email Worker forwards them
// when it can (README → "Reply tracking"). Subject and body patterns cover
// mail from Workers that don't forward headers yet.
//
// tests/auto-mail.test.ts holds the development cases;
// tests/heuristics-eval.test.ts scores both detectors on labelled sets.

import { rulesVersion } from "@/lib/outreach/rules-version";

export type MailHeaders = Record<string, string | string[] | null | undefined>;

export type AutoMailInput = {
  from?: string | null;
  subject?: string | null;
  text?: string | null;
  headers?: MailHeaders | null;
};

/** A header's value (case-insensitive name), joined if repeated, or null. */
export function headerValue(headers: MailHeaders | null | undefined, name: string): string | null {
  if (!headers) return null;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== wanted || value == null) continue;
    return Array.isArray(value) ? value.join(", ") : String(value);
  }
  return null;
}

// --- Automatic replies ---------------------------------------------------

const AUTO_SUBJECT_RE =
  /^\s*(?:(?:re|aw|fw|fwd)\s*:\s*)*(?:automatic\s+reply|auto(?:matic)?[\s-]?(?:reply|response|respond(?:er)?)|autoreply|out\s+of\s+(?:the\s+)?office|ooo\b|away\s+from\s+(?:the\s+)?office|on\s+vacation|vacation\s+(?:reply|notice|response)|abwesenheitsnotiz|absence\s+du\s+bureau|r[ée]ponse\s+automatique|respuesta\s+autom[áa]tica)/i;

// Phrases that only an out-of-office or autoresponder writes.
const AUTO_BODY_PATTERNS: RegExp[] = [
  /\b(?:i\s+am|i'?m|we\s+are|we'?re)\s+(?:currently\s+)?(?:out\s+of\s+(?:the\s+)?office|away\s+from\s+(?:the|my)\s+(?:office|desk)|on\s+(?:vacation|holiday|leave|pto|maternity\s+leave|paternity\s+leave))\b/i,
  /\b(?:i\s+am|i'?m|i\s+will\s+be|i'?ll\s+be)\s+(?:currently\s+)?(?:out|away)\s+(?:of\s+(?:the\s+)?office\s+)?(?:until|through|thru|till|from)\b/i,
  /\baway\s+until\b/i,
  /\bout\s+of\s+(?:the\s+)?office\s+(?:until|through|thru|till|from|on|and)\b/i,
  /\b(?:with\s+)?limited\s+(?:access\s+to\s+(?:e-?mail|my\s+inbox)|e-?mail\s+access)\b/i,
  /\bthis\s+is\s+an\s+auto(?:mated|matic)?(?:[\s-]generated)?\s+(?:reply|response|message)\b/i,
  /\bauto(?:mated|matic)[\s-](?:reply|response)\b/i,
  /\b(?:thank\s+you|thanks)\s+for\s+(?:your\s+(?:e-?mail|message|inquiry)|contacting\s+us|reaching\s+out)[^.!\n]{0,80}\b(?:we|i)\s+(?:will|'ll)\s+(?:respond|reply|get\s+back|be\s+in\s+touch)\b[^.!\n]{0,60}\b(?:as\s+soon\s+as|within|shortly|upon\s+my\s+return)/i,
  /\bupon\s+my\s+return\b/i,
];

/**
 * Why this message is an automatic reply, in words for the lead's history
 * ("Auto-Submitted: auto-replied header", "subject “Automatic reply: …”"),
 * or null when a person seems to have written it.
 */
export function detectAutoReply(input: AutoMailInput): string | null {
  const h = input.headers;
  const autoSubmitted = headerValue(h, "auto-submitted")?.trim().toLowerCase();
  if (autoSubmitted && !autoSubmitted.startsWith("no")) return `Auto-Submitted: ${autoSubmitted} header`;
  for (const name of ["X-Autoreply", "X-Autorespond", "X-Autoresponder"]) {
    const value = headerValue(h, name);
    if (value !== null && !/^\s*(?:no|false|0)\s*$/i.test(value)) return `${name} header`;
  }
  const precedence = headerValue(h, "precedence")?.trim().toLowerCase();
  if (precedence && /^(?:auto_reply|bulk|junk)$/.test(precedence)) return `Precedence: ${precedence} header`;
  const suppress = headerValue(h, "x-auto-response-suppress");
  if (suppress && /\b(?:all|oof|autoreply)\b/i.test(suppress)) return `X-Auto-Response-Suppress: ${suppress.trim()} header`;

  const subject = (input.subject ?? "").trim();
  if (subject && AUTO_SUBJECT_RE.test(subject)) return `subject “${subject.slice(0, 120)}”`;

  // Only the top of the message: an out-of-office quoted inside a real
  // reply ("I got your auto-reply…") is rare, but a pitch quoted below one
  // is common, and our pitch doesn't use these phrases.
  const body = (input.text ?? "").slice(0, 2_000);
  for (const re of AUTO_BODY_PATTERNS) {
    const match = re.exec(body);
    if (match) return `wording “${match[0].replace(/\s+/g, " ").trim()}”`;
  }
  return null;
}

// --- Bounces (delivery-status notifications) -------------------------------

const BOUNCE_SENDER_RE = /^(?:mailer-daemon|postmaster|mail-daemon|mailerdaemon|bounces?|mail\s*delivery\s*(?:subsystem|system)?)(?:[@+]|$)/i;
const BOUNCE_SUBJECT_RE =
  /\b(?:undeliver(?:able|ed)|undelivered\s+mail|delivery\s+(?:status\s+notification\s*\((?:failure|delay)\)|has\s+failed|failure|failed|incomplete)|returned\s+(?:mail|to\s+sender)|mail\s+delivery\s+(?:failed|failure|subsystem)|could\s+not\s+be\s+delivered|failure\s+notice|message\s+not\s+delivered|non[\s-]?delivery)\b/i;
const BOUNCE_BODY_RE =
  /\b(?:could\s+not\s+be\s+delivered|couldn'?t\s+be\s+delivered|wasn'?t\s+delivered|was\s+not\s+delivered|delivery\s+(?:to\s+the\s+following\s+recipients?\s+)?(?:has\s+)?failed(?:\s+permanently)?|undeliverable|user\s+unknown|no\s+such\s+user|mailbox\s+(?:unavailable|not\s+found|does\s+not\s+exist)|address\s+(?:not\s+found|couldn'?t\s+be\s+found|rejected)|recipient\s+address\s+rejected|permanent\s+(?:fatal\s+)?error|Final-Recipient:|Diagnostic-Code:|Status:\s*5\.\d{1,3}\.\d{1,3})/i;
const SMTP_PERMANENT_RE = /\b(?:5[0-5]\d[\s-]+)?5\.\d{1,3}\.\d{1,3}\b/;

export type BounceInfo = {
  /** The address that couldn't be delivered to, when the notice names one. */
  failedRecipient: string | null;
  /** Why it was read as a bounce, in words. */
  reason: string;
  /** The SMTP status or diagnostic line, if one was found. */
  diagnostic: string | null;
};

const EMAIL_RE = /[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

function failedRecipientFrom(text: string, senderDomains: string[]): string | null {
  // Standard DSN fields first.
  const field = /^\s*(?:Final|Original)-Recipient:\s*(?:rfc822;)?\s*<?([^\s<>;]+@[^\s<>;]+)>?/im.exec(text);
  if (field) return field[1]!.toLowerCase();
  const xFailed = /^\s*X-Failed-Recipients:\s*<?([^\s<>,]+@[^\s<>,]+)>?/im.exec(text);
  if (xFailed) return xFailed[1]!.toLowerCase();
  // Otherwise the first address that isn't the bouncing server or ours.
  for (const match of text.matchAll(EMAIL_RE)) {
    const address = match[0].toLowerCase().replace(/\.$/, "");
    const [local, domain] = address.split("@") as [string, string];
    if (BOUNCE_SENDER_RE.test(local)) continue;
    if (senderDomains.some((d) => domain === d || domain.endsWith(`.${d}`))) continue;
    return address;
  }
  return null;
}

/**
 * Whether this message is a delivery-failure notice, and for which address.
 * `ownDomains` are our sending domains, never taken for the failed recipient.
 */
export function detectBounce(input: AutoMailInput, ownDomains: string[] = []): BounceInfo | null {
  const from = (input.from ?? "").toLowerCase();
  const address = (from.match(/<([^>]+)>/)?.[1] ?? from).trim();
  const local = address.split("@")[0] ?? "";
  const subject = input.subject ?? "";
  const text = input.text ?? "";
  const xFailed = headerValue(input.headers, "x-failed-recipients");
  const contentType = headerValue(input.headers, "content-type") ?? "";

  const fromDaemon = BOUNCE_SENDER_RE.test(local) || /mail delivery (?:subsystem|system)/i.test(from);
  const dsnContent = /multipart\/report;.*report-type=["']?delivery-status/i.test(contentType) || /^\s*Final-Recipient:/im.test(text);
  // A mail server's notice never starts "Re:" — that's a person replying
  // to a subject that happens to say "Undeliverable".
  const subjectSaysSo = !/^\s*re\s*:/i.test(subject) && BOUNCE_SUBJECT_RE.test(subject);
  const bodySaysSo = BOUNCE_BODY_RE.test(text);
  const smtp = SMTP_PERMANENT_RE.exec(text);

  // A person can write "your email couldn't be delivered to my colleague",
  // so body wording alone isn't enough: it has to come from a mail server,
  // carry DSN fields, or have a bounce subject plus bounce wording/codes.
  const isBounce = fromDaemon || dsnContent || xFailed !== null || (subjectSaysSo && (bodySaysSo || smtp !== null));
  if (!isBounce) return null;

  const failedRecipient =
    (xFailed ? xFailed.split(",")[0]!.trim().replace(/^<|>$/g, "").toLowerCase() : null) ??
    failedRecipientFrom(text, ownDomains.map((d) => d.toLowerCase()));
  const diagnosticLine = /^\s*Diagnostic-Code:\s*(.+)$/im.exec(text)?.[1] ?? smtp?.[0] ?? null;
  const reason = fromDaemon
    ? `delivery-failure notice from ${address}`
    : dsnContent || xFailed
      ? "delivery-status report"
      : `delivery-failure notice (“${subject.slice(0, 120)}”)`;
  return { failedRecipient, reason, diagnostic: diagnosticLine ? diagnosticLine.trim().slice(0, 200) : null };
}

/**
 * Identifies this version of the automatic-reply and bounce rules; stored
 * on every InboundReply. Bump the revision when the logic changes without a
 * pattern changing.
 */
export const AUTO_MAIL_RULES_VERSION = rulesVersion("auto", 1, [
  AUTO_SUBJECT_RE,
  AUTO_BODY_PATTERNS,
  BOUNCE_SENDER_RE,
  BOUNCE_SUBJECT_RE,
  BOUNCE_BODY_RE,
  SMTP_PERMANENT_RE,
  EMAIL_RE,
]);
