// Courtesy replies for the reply classifier (reply-classifier.ts): a reply
// that is ONLY a thank-you or an acknowledgement ("Thanks!", "Got it",
// "Received", "OK, thank you", "Thanks,\nMaria"). It says nothing about
// interest either way, so it is neither a positive reply nor an opt-out:
// the lead stays where it was and the address is held from further email.
//
// The whole reply has to be made of these phrases (after an optional
// greeting and before an optional name), so anything else in it — a
// question, a "but no", a request — sends it through the other rules.

import { ENGLISH_WORDS } from "@/lib/outreach/reply-rules/language";

const THANKS = String.raw`(?:thanks|thank\s+you|thank\s+u|thanx|thx|ty|tysm|many\s+thanks|much\s+appreciated|appreciated|(?:i\s+)?appreciate\s+it)`;
const THANKS_INTENSIFIER = String.raw`(?:\s+(?:so\s+much|very\s+much|a\s+lot|a\s+bunch|again|kindly))?`;
const THANKS_FOR = String.raw`(?:\s+for\s+(?:(?:reaching|getting)\s+(?:out|in\s+touch)|the\s+(?:e-?mail|note|info|information|message|heads\s+up|update|follow\s+up)|your\s+(?:e-?mail|note|message|time)|sending\s+(?:this|that|it)(?:\s+over)?|letting\s+(?:me|us)\s+know|thinking\s+of\s+(?:me|us)))?`;
const ACKNOWLEDGEMENT = String.raw`(?:got\s+it|received|noted|understood|ok|okay|k|kk)`;

/** The reply, lower-cased with punctuation and emoji removed, is only courtesy phrases. */
export const COURTESY_RE = new RegExp(String.raw`^(?:(?:${THANKS}${THANKS_INTENSIFIER}${THANKS_FOR}|${ACKNOWLEDGEMENT})(?:\s+|$))+$`, "i");

// "Hi," / "Hello Thomas," / "Good morning Thomas —" at the start of a reply.
const GREETING = String.raw`^\s*(?:hi|hello|hey|dear|good\s+(?:morning|afternoon|evening))\b`;
export const GREETING_RES = [
  new RegExp(String.raw`${GREETING}\s+\S+?\s*[,.!:—–\n-]\s*`, "i"),
  new RegExp(String.raw`${GREETING}\s*[,.!:—–-]?\s*`, "i"),
];

// Words that can't be a name signed under a thank-you ("Thanks\nNo").
export const NOT_A_NAME = new Set(
  "no nope nah not never stop remove unsubscribe maybe sure yes yeah ok okay pass later sorry spam again but however".split(" "),
);

/** One to three capitalised words that read as a name or a firm, not as words of the reply. */
function isNameLine(line: string): boolean {
  const words = line
    .trim()
    .replace(/[.,!]+$/, "")
    .split(/\s+/);
  if (words.length === 0 || words.length > 3) return false;
  return words.every((word) => {
    const lower = word.toLowerCase();
    return /^\p{Lu}[\p{L}.'-]*$/u.test(word) && !NOT_A_NAME.has(lower) && !ENGLISH_WORDS.has(lower);
  });
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[^\p{L}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Whether the replier's own words (extractNewReplyText) are nothing but courtesy. */
export function isCourtesyOnly(text: string): boolean {
  // With a greeting and a name, a bare greeting, or none.
  return [...GREETING_RES.map((re) => text.replace(re, "")), text].some(isCourtesy);
}

function isCourtesy(reply: string): boolean {
  const body = reply.trim();
  if (!body) return false;
  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length > 2) return false;
  if (lines.length === 2 && !isNameLine(lines[1]!)) return false;
  const first = lines[0]!;
  if (COURTESY_RE.test(normalize(first))) return true;
  // "Thanks, Maria" / "Thank you — Bob Smith" on one line.
  const signed = /^(.*?)[\s,—–-]+(\p{Lu}[\p{L}.'-]*(?:\s+\p{Lu}[\p{L}.'-]*){0,2})[\s.!]*$/u.exec(first);
  return signed !== null && COURTESY_RE.test(normalize(signed[1]!)) && isNameLine(signed[2]!);
}
