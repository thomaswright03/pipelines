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
// 2. What's left must *ask* to opt out: a line that is just the command
//    ("STOP", "Unsubscribe", "Please remove me"), or an explicit phrase
//    ("take me off your list", "stop emailing me", "don't contact me
//    again"). Ordinary uses of the words ("stop by the office", "can't stop
//    thinking about it") don't count.

export type ReplyClassification = {
  optOut: boolean;
  /** The words that were read as an opt-out, for display on the lead. */
  trigger: string | null;
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
  "stop emailing",
  "stop emailing me",
  "stop sending",
  "no more emails",
]);
const FILLER_RE = /\b(please|pls|plz|kindly|thanks|thank you|thx|asap|now)\b/g;

// Explicit requests anywhere in the new text.
const OPT_OUT_PHRASES: RegExp[] = [
  /\bunsubscribe\b/i,
  /\bopt(?:ing)?[\s-]?(?:me\s+)?out\b/i,
  /\bremove\s+(?:me|us|my\s+(?:e-?mail|address|name)|this\s+(?:e-?mail|address))\b/i,
  /\btake\s+(?:me|us|my\s+(?:e-?mail|address|name))\s+off\b/i,
  /\bstop\s+(?:e-?mailing|contacting|messaging|spamming|sending(?:\s+me)?(?:\s+(?:e-?mails?|these|this))?|writing\s+to)\b/i,
  /\b(?:do\s+not|don'?t|dont|never)\s+(?:e-?mail|contact|message|write\s+to)\s+(?:me|us)\s+(?:again|anymore|any\s+more|ever)\b/i,
  /\bno\s+more\s+e-?mails?\b/i,
];

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

  for (const line of newText.split("\n")) {
    const normalized = normalizeCommandLine(line);
    if (normalized && COMMAND_WORDS.has(normalized)) {
      return { optOut: true, trigger: line.trim(), newText };
    }
  }

  for (const re of OPT_OUT_PHRASES) {
    const match = re.exec(newText);
    if (match) {
      return { optOut: true, trigger: sentenceAround(newText, match.index, match[0].length), newText };
    }
  }

  // A reply whose subject was changed to just "STOP"/"Unsubscribe".
  const subject = stripReplyPrefix(input.subject ?? "");
  if (subject && COMMAND_WORDS.has(normalizeCommandLine(subject))) {
    return { optOut: true, trigger: `Subject: ${subject}`, newText };
  }

  return { optOut: false, trigger: null, newText };
}

function sentenceAround(text: string, index: number, length: number): string {
  const start = Math.max(text.lastIndexOf("\n", index) + 1, 0);
  const endNewline = text.indexOf("\n", index + length);
  const end = endNewline === -1 ? text.length : endNewline;
  const line = text.slice(start, end).trim();
  return line.length > 200 ? `${line.slice(0, 200)}…` : line;
}
