// Decides whether an inbound reply is a genuine opt-out request.
//
// Both outreach templates end with "Reply STOP and we won't email you
// again", and most mail clients quote the original message below a reply.
// Matching opt-out words anywhere in the body therefore flagged nearly
// every reply — including enthusiastic ones — as an opt-out. So:
//
// 1. Only the replier's own new text counts: quoted history (">" lines,
//    "On … wrote:", Outlook's "From:/Sent:" header blocks, "Original
//    Message" separators), signatures and our own template footer are cut.
// 2. What's left must *ask* not to be contacted: a line that is just the
//    command ("STOP", "Unsubscribe", "Please remove me"), or an explicit
//    phrase ("take me off your list", "don't email me", "quit contacting
//    us", "delete my email address", "leave me alone"). Ordinary uses of the
//    words ("stop by the office", "can't stop thinking about it") and
//    negated ones ("please don't stop sending these") don't count.
// 3. A reply that isn't an opt-out but reads like a brush-off or a
//    complaint ("not interested", "wrong person", "how did you get my
//    email") is flagged for a human look (`review`) instead of being
//    treated as an ordinary positive reply.
//
// tests/reply-classifier.test.ts holds the development cases;
// tests/heuristics-eval.test.ts measures precision and recall on a
// separate labelled set and fails the build if they drop.

export type ReplyClassification = {
  optOut: boolean;
  /** The words that were read as an opt-out, for display on the lead. */
  trigger: string | null;
  /**
   * Not an opt-out, but worth a human look before treating it as a
   * positive reply: why, in words for the lead page. Null otherwise.
   */
  review: string | null;
  /** The replier's own text with quoted history and signatures removed. */
  newText: string;
};

// A line on its own that means "opt me out" once filler words and
// punctuation are stripped.
const COMMAND_WORDS = new Set([
  "stop",
  "stop all",
  "stopall",
  "unsubscribe",
  "unsub",
  "remove",
  "remove me",
  "optout",
  "opt out",
  "opt me out",
  "stop it",
  "stop this",
  "stop emailing",
  "stop emailing me",
  "stop sending",
  "no more emails",
]);
const FILLER_RE = /\b(please|pls|plz|kindly|thanks|thank you|thx|asap|now)\b/g;

const ME = String.raw`(?:me|us|this\s+(?:e-?mail\s+)?(?:address|account|e-?mail))`;
const CONTACT_VERB = String.raw`(?:e-?mail|contact|message|text|write\s+to|reach\s+out\s+to|send\s+(?:me|us)\s+(?:any\s*more\s+|more\s+)?(?:e-?mails?|messages?|anything|stuff))`;
const NEG = String.raw`(?:do\s+not|don'?t|dont|never|please\s+don'?t)`;
const LIST = String.raw`(?:(?:your|the|this|all|any|every|ur)\s+)?(?:(?:e-?mail(?:ing)?|mailing|contact|distribution|marketing|call)\s+)?lists?`;

// Explicit requests anywhere in the new text.
const OPT_OUT_PHRASES: RegExp[] = [
  /\bunsubscribe\b/i,
  /\bopt(?:ing)?[\s-]?(?:me\s+)?out\b/i,
  // "remove me", "remove my email", "please remove from list"
  /\bremove\s+(?:me|us|my\s+(?:e-?mail|address|name|info)|this\s+(?:e-?mail|address))\b/i,
  new RegExp(String.raw`\bremove\s+(?:(?:me|us|it|this)\s+)?from\s+${LIST}\b`, "i"),
  /\btake\s+(?:me|us|my\s+(?:e-?mail|address|name))\s+off\b/i,
  /\b(?:stop|quit|cease)\s+(?:e-?mailing|contacting|messaging|spamming|texting|calling|sending(?:\s+me)?(?:\s+(?:e-?mails?|these|this|messages?))?|writing\s+to|reaching\s+out)\b/i,
  // "don't email me", "do not contact us", "don't reach out to me again", "don't send me emails"
  new RegExp(String.raw`\b${NEG}\s+(?:ever\s+)?${CONTACT_VERB}(?:\s+${ME})?(?=\s+(?:again|anymore|any\s+more|ever)\b|\s*[.!,;]|\s*$)`, "im"),
  new RegExp(
    String.raw`\b${NEG}\s+(?:ever\s+)?(?:e-?mail|contact|message|text|write\s+to|reach\s+out\s+to)\s+${ME}\b(?!\s+(?:until|till|before|after|about|regarding|with\s+questions))`,
    "i",
  ),
  new RegExp(String.raw`\b${NEG}\s+(?:e-?mail|contact|message|reach\s+out|write)\s+(?:again|anymore|any\s+more)\b`, "i"),
  /\bno\s+more\s+(?:e-?mails?|messages?|contact)\b/i,
  // "do not send further emails", "don't send me anything else"
  new RegExp(
    String.raw`\b${NEG}\s+send\s+(?:(?:me|us)\s+)?(?:any\s*(?:more|thing)|further|more|other|anything(?:\s+else)?)(?:\s+(?:e-?mails?|messages?|stuff))?(?=\s*[.!,;]|\s*$|\s+(?:e-?mails?|messages?|again|to\s+(?:me|us|this)))`,
    "im",
  ),
  /\b(?:delete|erase|purge)\s+(?:my|our)\s+(?:e-?mail(?:\s+address)?|address|info(?:rmation)?|contact(?:\s+(?:info|details))?|details|data)\b/i,
  /\b(?:delete|erase)\s+(?:me|us)\s+from\b/i,
  /\bcease\s+and\s+desist\b/i,
  /\bleave\s+(?:me|us)\s+alone\b/i,
  /\b(?:i|we)\s+(?:do\s+not|don'?t)\s+want\s+(?:any\s+more|any|more|your)\s+(?:e-?mails?|messages?)\b/i,
];

// Not an opt-out on their own, but not a "yes" either: the lead is flagged
// for a look instead of being moved to Responded.
const REVIEW_PHRASES: { re: RegExp; reason: string }[] = [
  { re: /\bnot\s+(?:at\s+all\s+|really\s+)?interested\b/i, reason: "says they're not interested" },
  { re: /\bno\s+(?:thanks|thank\s+you|thx)\b/i, reason: "says no thanks" },
  { re: /\bwrong\s+(?:person|e-?mail|address|contact|guy|gal)\b/i, reason: "says this is the wrong person" },
  { re: /\b(?:no\s+longer|not)\s+(?:work(?:ing)?\s+(?:here|there|at)|with\s+(?:the|this)\s+(?:company|brokerage|firm))\b/i, reason: "says they no longer work there" },
  { re: /\bhow\s+did\s+you\s+get\s+(?:my|this|our)\b/i, reason: "asks how we got their address" },
  { re: /\b(?:spam|spammer|spamming|unsolicited)\b|\breport(?:ed|ing)?\s+(?:you|this|it)\b/i, reason: "calls the email spam" },
  { re: /\b(?:retired|passed\s+away|deceased)\b/i, reason: "says the person has retired or died" },
];

// A phrase right after one of these is being negated, not requested:
// "please don't stop emailing me", "I'm not asking to unsubscribe", "never
// stop sending these". Only filler words may sit between the negation and
// the phrase, so "I'm not interested, stop emailing me" still counts.
const NEGATION_BEFORE_RE =
  /\b(?:don'?t|dont|do\s+not|doesn'?t|does\s+not|never|not|no\s+need\s+to|won'?t|wouldn'?t|shouldn'?t)(?:\s+(?:please|ever|you|to|want|wanting|asking|ask|need|trying|going|mean|meaning|planning|plan))*\s*$/i;

/** Whether the words just before `index` (within the same clause) negate what follows. */
function isNegated(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 60), index);
  const clause = before.split(/[.!?;,\n]/).pop() ?? "";
  return NEGATION_BEFORE_RE.test(clause);
}

// Our own footer, in case a client quotes it without ">" markers.
const TEMPLATE_FOOTER_RE = /don'?t want to hear from us again\?\s*reply stop and we won'?t email you again\.?/gi;

const QUOTE_HEADER_PATTERNS: RegExp[] = [
  /^\s*On\b[^\n]{0,300}?\bwrote:\s*$/im, // Gmail/Apple: "On Thu, Sep 25 … wrote:"
  /^\s*On\b[^\n]{0,300}\n[^\n]{0,300}\bwrote:\s*$/im, // same, wrapped onto two lines
  /^\s*-{2,}\s*(?:Original|Forwarded)\s+Message\s*-{2,}/im,
  /^\s*_{10,}\s*$/m, // Outlook's separator rule
  /^\s*From:\s.+\n(?:.*\n){0,3}?\s*(?:Sent|Date):\s/im, // Outlook header block
  /^\s*Le\s.+a\s+écrit\s*:\s*$/im,
];

const SIGNATURE_PATTERNS: RegExp[] = [
  /^--\s*$/m, // RFC 3676 signature delimiter
  /^\s*Sent from my\s.+$/im,
  /^\s*Get Outlook for\s.+$/im,
];

/** The replier's own text: everything above quoted history or a signature. */
export function extractNewReplyText(raw: string): string {
  let text = (raw ?? "").replace(/\r\n?/g, "\n");

  let cut = text.length;
  for (const re of [...QUOTE_HEADER_PATTERNS, ...SIGNATURE_PATTERNS]) {
    const match = re.exec(text);
    if (match && match.index < cut) cut = match.index;
  }
  text = text.slice(0, cut);

  text = text
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n")
    .replace(TEMPLATE_FOOTER_RE, "");

  return text.trim();
}

function normalizeCommandLine(line: string): string {
  return line
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/'/g, "")
    .replace(FILLER_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripReplyPrefix(subject: string): string {
  return subject.replace(/^\s*((re|fw|fwd|aw)\s*:\s*)+/i, "").trim();
}

export function classifyReply(input: { subject?: string | null; text?: string | null }): ReplyClassification {
  const newText = extractNewReplyText(input.text ?? "");
  const optOut = (trigger: string): ReplyClassification => ({ optOut: true, trigger, review: null, newText });

  for (const line of newText.split("\n")) {
    const normalized = normalizeCommandLine(line);
    if (normalized && COMMAND_WORDS.has(normalized)) return optOut(line.trim());
  }

  for (const re of OPT_OUT_PHRASES) {
    const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
    for (const match of newText.matchAll(new RegExp(re.source, flags))) {
      if (isNegated(newText, match.index)) continue;
      return optOut(sentenceAround(newText, match.index, match[0].length));
    }
  }

  // A reply whose subject was changed to just "STOP"/"Unsubscribe".
  const subject = stripReplyPrefix(input.subject ?? "");
  if (subject && COMMAND_WORDS.has(normalizeCommandLine(subject))) return optOut(`Subject: ${subject}`);

  for (const { re, reason } of REVIEW_PHRASES) {
    const match = re.exec(newText);
    if (match) return { optOut: false, trigger: null, review: `${reason}: “${sentenceAround(newText, match.index, match[0].length)}”`, newText };
  }

  return { optOut: false, trigger: null, review: null, newText };
}

function sentenceAround(text: string, index: number, length: number): string {
  const start = Math.max(text.lastIndexOf("\n", index) + 1, 0);
  const endNewline = text.indexOf("\n", index + length);
  const end = endNewline === -1 ? text.length : endNewline;
  const line = text.slice(start, end).trim();
  return line.length > 200 ? `${line.slice(0, 200)}…` : line;
}
