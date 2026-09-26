// Reads an inbound reply and decides what the app may do with it by itself.
//
// Only a CONFIDENT reading acts automatically. Every reply gets one of:
//
//   opt_out      — the reply asks not to be emailed, and nothing in it pulls
//                  the other way. The address is suppressed at once (CAN-SPAM).
//   positive     — the reply shows interest (a yes, a question, a request)
//                  and nothing in it could be asking us to stop or saying no.
//                  It counts as a reply and moves the lead to Responded.
//   declined     — a plain no ("Not interested", "No thanks", "We're all
//                  set") and nothing else: no stop word, complaint, hedge,
//                  question or interest. The lead is closed (Lost / Not
//                  interested) and no email goes to the address again. It is
//                  not an opt-out: the address isn't put on the do-not-email
//                  list, it is held.
//   acknowledged — only a courtesy note ("Thanks!", "Got it", "Received").
//                  Neither a positive reply nor an opt-out: the lead stays
//                  where it was (it still moves to phone outreach after a
//                  week) and no email goes to the address again.
//   needs_look   — anything else. The lead is flagged "Reply needs a look",
//                  it doesn't count as a reply or as an opt-out, and no email
//                  goes to the address until the operator resolves it (see
//                  inbound.ts and send.ts). The operator can mark it opted out.
//
// So an uncertain reply is never counted as positive and never suppressed
// automatically, and every verdict but "positive" stops email to the address.
//
// Precedence (the first step that applies decides). The phrase lists live
// in reply-rules/, one module per group:
//
//   0. Only the replier's own words are read: quoted history, signatures,
//      sign-offs, legal and newsletter footers and our own "Reply STOP"
//      footer are removed first (reply-rules/reply-text.ts).
//   1. STOP REQUEST (reply-rules/stop.ts): an explicit request not to be
//      emailed ("STOP", "Remove me", "Please stop emailing me").
//        - it names only calls or texts ("stop calling my cell") → needs_look
//        - the reply also shows INTEREST anywhere                → needs_look
//        - otherwise                                             → opt_out
//   2. STOP WORDS (reply-rules/stop.ts): words that *can* be part of asking
//      not to be emailed ("exclude", "no further", "off … list")  → needs_look
//   3. COMPLAINT (reply-rules/decline.ts): "wrong person", "who is this",
//      "how did you get my email", "spam"                         → needs_look
//   4. HEDGE (reply-rules/decline.ts): "maybe", "I guess", "not sure"
//                                                                 → needs_look
//   5. ANOTHER LANGUAGE (reply-rules/language.ts)                 → needs_look
//   6. PLAIN DECLINE (reply-rules/decline.ts): "not interested", "no
//      thanks", "all set", "already have one"
//        - the reply also shows INTEREST                         → needs_look
//        - otherwise                                             → declined
//   7. COURTESY ONLY (reply-rules/courtesy.ts): the whole reply is thanks
//      or an acknowledgement                                     → acknowledged
//   8. INTEREST (reply-rules/interest.ts: a yes, a question, a phone number,
//      an address to use instead)                                → positive
//   9. Nothing recognised                                        → needs_look
//
// Each group has example phrasings in reply-rules/examples.ts;
// tests/reply-classifier.test.ts asserts every one of them.
// REPLY_RULES_VERSION identifies these rules on every stored verdict.
// tests/heuristics-eval.test.ts scores the rules on labelled sets and
// reports how many replies land on each verdict.

import { rulesVersion } from "@/lib/outreach/rules-version";
import {
  ASKS_ABOUT_STOPPING_BEFORE_RE,
  EMAIL_WORD_RE,
  FILLER_RE,
  isNegated,
  LATER_RE,
  NEGATION_BEFORE_RE,
  normalizeCommandLine,
  OTHER_CHANNEL_RE,
  STOP_COMMANDS,
  STOP_CUES,
  STOP_REQUESTS,
  stripReplyPrefix,
} from "@/lib/outreach/reply-rules/stop";
import { COMPLAINTS, HEDGE_RE, PLAIN_DECLINES, REAL_QUESTION_RE } from "@/lib/outreach/reply-rules/decline";
import { ENGLISH_WORDS, FOREIGN_WORDS, isMainlyForeign, looksForeign, MIN_WORDS_FOR_LANGUAGE } from "@/lib/outreach/reply-rules/language";
import { CONTACT_DETAIL_RE, INTEREST_SIGNALS, NEGATION_WORD_RE, NOT_A_NEGATION_RE, QUESTION_RE } from "@/lib/outreach/reply-rules/interest";
import { COURTESY_RE, GREETING_RES, isCourtesyOnly, NOT_A_NAME } from "@/lib/outreach/reply-rules/courtesy";
import {
  extractNewReplyText,
  POSTSCRIPT_RE,
  QUOTE_HEADER_PATTERNS,
  SIGN_OFF_RE,
  SIGNATURE_PATTERNS,
  TEMPLATE_FOOTER_RE,
} from "@/lib/outreach/reply-rules/reply-text";

export { extractNewReplyText } from "@/lib/outreach/reply-rules/reply-text";
export { RULE_EXAMPLES } from "@/lib/outreach/reply-rules/examples";

export type ReplyVerdict = "opt_out" | "positive" | "declined" | "acknowledged" | "needs_look";

/** Verdicts after which nothing more is emailed to the address, without the operator having to look (send.ts). */
export const HOLDING_VERDICTS: readonly ReplyVerdict[] = ["declined", "acknowledged"];

type ReplyClassification = {
  verdict: ReplyVerdict;
  /** verdict === "opt_out". */
  optOut: boolean;
  /** For an opt-out or a decline: the words it was read from, for display on the lead. */
  trigger: string | null;
  /** For needs_look: one sentence saying why, for the lead page. Null otherwise. */
  review: string | null;
  /** For a decline: what it says, e.g. "says they're not interested". Null otherwise. */
  declineReason: string | null;
  /** For needs_look: the reply has words that may be asking not to be emailed. */
  mayBeOptOut: boolean;
  /** The replier's own text with quoted history, signatures and footers removed. */
  newText: string;
};

type Found = { index: number; text: string; /** How to name it in a reason, when not by quoting `text`. */ label?: string };

/** The first match of any of `patterns` in `text` that `accept` allows. */
function firstMatch(text: string, patterns: readonly RegExp[], accept: (m: Found) => boolean = () => true): Found | null {
  let best: Found | null = null;
  for (const re of patterns) {
    const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
    for (const match of text.matchAll(new RegExp(re.source, flags))) {
      const found = { index: match.index, text: match[0] };
      if (!accept(found)) continue;
      if (!best || found.index < best.index) best = found;
      break;
    }
  }
  return best;
}

/** Whether a positive signal at `index` is negated in its own clause ("not that interested"). */
function negatedInClause(text: string, index: number, ignore: RegExp | null): boolean {
  const clause =
    text
      .slice(Math.max(0, index - 80), index)
      .split(/[.!?;,:\n—–]|\bbut\b/)
      .pop() ?? "";
  return NEGATION_WORD_RE.test(ignore ? clause.replace(ignore, "") : clause);
}

/** A sign of interest not negated in its own clause, a number or address to use, or (optionally) a question. */
function findInterest(text: string, { countQuestions }: { countQuestions: boolean }): Found | null {
  const signal = firstMatch(text, INTEREST_SIGNALS, ({ index }) => !negatedInClause(text, index, NOT_A_NEGATION_RE));
  if (signal) return signal;
  const detail = CONTACT_DETAIL_RE.exec(text);
  if (detail) return { index: detail.index, text: detail[0], label: "gives a number or address to use" };
  if (countQuestions) {
    const question = QUESTION_RE.exec(text);
    if (question) return { index: question.index, text: question[0], label: "asks a question" };
  }
  return null;
}

/**
 * Whether `text` says yes or "interested" in so many words (not negated) —
 * a stronger sign than a question or a phone number, which out-of-office
 * messages also contain. Used to keep a reply that merely mentions being
 * out of the office from being filed as automatic (see inbound.ts).
 */
export function showsClearInterest(text: string): boolean {
  const own = extractNewReplyText(text).replace(/[‘’ʼ]/g, "'");
  return firstMatch(own, INTEREST_SIGNALS.slice(0, 3), ({ index }) => !negatedInClause(own, index, null)) !== null;
}

/** Whether the unsubscribe at `index` is asked about for later ("can I unsubscribe later if…?") rather than requested. */
function asksAboutStoppingLater(text: string, index: number, length: number): boolean {
  const clause =
    text
      .slice(Math.max(0, index - 60), index)
      .split(/[.!?;,\n]/)
      .pop() ?? "";
  if (!ASKS_ABOUT_STOPPING_BEFORE_RE.test(clause)) return false;
  const rest = text.slice(index + length);
  const end = rest.search(/[.!?\n]/);
  if (end === -1 || rest[end] !== "?") return false;
  return LATER_RE.test(rest.slice(0, end));
}

/** The first explicit stop request, or null. Negated ones and questions about stopping later don't count. */
function findStopRequest(text: string, subject: string): Found | null {
  // A line or sentence that is just the command ("STOP", "Remove me.").
  let lineStart = 0;
  for (const line of text.split("\n")) {
    for (const part of [line, ...line.split(/(?<=[.!?,;])\s+/)]) {
      if (STOP_COMMANDS.has(normalizeCommandLine(part))) return { index: lineStart + line.indexOf(part), text: part };
    }
    lineStart += line.length + 1;
  }
  const phrase = firstMatch(
    text,
    STOP_REQUESTS,
    ({ index, text: words }) =>
      !isNegated(text, index) && !(/^(?:unsubscribe|opt)/i.test(words.trim()) && asksAboutStoppingLater(text, index, words.length)),
  );
  if (phrase) return phrase;
  // A reply whose subject was changed to just "STOP"/"Unsubscribe".
  const bare = stripReplyPrefix(subject);
  if (bare && STOP_COMMANDS.has(normalizeCommandLine(bare))) return { index: -1, text: `Subject: ${bare}` };
  return null;
}

/** The first stop word that isn't negated ("don't stop sending these"). */
function findStopCue(text: string): Found | null {
  return firstMatch(text, STOP_CUES, ({ index, text: words }) => {
    // "Don't hesitate to email me" isn't a negation; otherwise the
    // negated-contact cue carries its own negation.
    if (new RegExp(`^${NOT_A_NEGATION_RE.source}`, "i").test(words)) return false;
    if (/^(?:not|never|don|dont|didn|did|do|nor|no)\b/i.test(words)) return true;
    return !isNegated(text, index);
  });
}

/** `text` with the clause holding `found` blanked out (same length), so what's left can be searched for anything else. */
function withoutClause(text: string, found: Found): string {
  if (found.index < 0) return text;
  const clauseStart = Math.max(
    ...[".", "!", "?", ";", ",", "\n", "—", "–"].map((c) => text.lastIndexOf(c, found.index - 1) + 1),
    text.lastIndexOf(" but ", found.index) + 1,
    0,
  );
  const end = found.index + found.text.length;
  return text.slice(0, clauseStart) + " ".repeat(end - clauseStart) + text.slice(end);
}

export function classifyReply(input: { subject?: string | null; text?: string | null }): ReplyClassification {
  const newText = extractNewReplyText(input.text ?? "");
  // Phones send curly apostrophes ("don’t"); the rules are written with
  // straight ones. Same length, so match positions still line up.
  const text = newText.replace(/[‘’ʼ]/g, "'");
  const interest = findInterest(text, { countQuestions: true });
  const interested = (found: Found) => (found.label ? `also ${found.label}` : `also sounds interested (“${clip(found.text)}”)`);
  const base = { optOut: false, trigger: null, review: null, declineReason: null, mayBeOptOut: false, newText };
  const needsLook = (review: string, mayBeOptOut = false): ReplyClassification => ({
    ...base,
    verdict: "needs_look",
    review,
    mayBeOptOut,
  });

  // 1. An explicit stop request.
  const stop = findStopRequest(text, input.subject ?? "");
  if (stop) {
    // Interest elsewhere in the reply — not the lead-in to the request
    // itself ("I'd like to be removed…" asks for nothing else).
    const elsewhere = findInterest(withoutClause(text, stop), { countQuestions: true });
    const email = stop.index < 0 || EMAIL_WORD_RE.test(stop.text) || !OTHER_CHANNEL_RE.test(stop.text);
    if (!email) {
      return needsLook(`It asks us to stop calls or texts (“${clip(stop.text)}”) — check whether it also means email.`, true);
    }
    if (elsewhere) {
      return needsLook(
        `It reads like a request not to be emailed (“${clip(stop.text)}”) but ${interested(elsewhere)} — check which they mean.`,
        true,
      );
    }
    const trigger = stop.index < 0 ? stop.text : sentenceAround(newText, stop.index, stop.text.length);
    return { ...base, verdict: "opt_out", optOut: true, trigger };
  }

  if (!text.trim()) return needsLook("It has no text of its own (only the quoted email, a signature or a footer).");

  // 2. Words that may be part of asking not to be emailed.
  const cue = findStopCue(text);
  if (cue) {
    return needsLook(
      interest
        ? `It may be asking not to be emailed (“${clip(cue.text)}”), though it ${interested(interest)}.`
        : `It may be asking not to be emailed (“${clip(cue.text)}”).`,
      true,
    );
  }

  // 3. A complaint, or a question about who we are.
  const complaint = COMPLAINTS.find(({ re }) => re.test(text));
  if (complaint) return needsLook(`It ${complaint.reason}.`);

  // 4. Unsure, and not asking anything either ("Thanks, I guess?"; but
  // "Maybe — what's the minimum term?" asks a real question).
  const hedge = HEDGE_RE.exec(text);
  if (hedge && !(interest && (interest.label !== "asks a question" || REAL_QUESTION_RE.test(text)))) {
    return needsLook(`It sounds unsure (“${clip(hedge[0])}”), so it isn't a clear yes or no.`);
  }

  // 5. Another language.
  if (isMainlyForeign(text) || (!interest && looksForeign(text))) {
    return needsLook("It is written in another language, so the rules can't read it — check whether it asks to stop.");
  }

  // 6. A plain no.
  for (const { re, reason } of PLAIN_DECLINES) {
    const match = re.exec(text);
    if (!match) continue;
    const alsoInterested = findInterest(withoutClause(text, { index: match.index, text: match[0] }), { countQuestions: true });
    if (alsoInterested) return needsLook(`It ${reason} but ${interested(alsoInterested)} — check which they mean.`);
    return { ...base, verdict: "declined", trigger: sentenceAround(newText, match.index, match[0].length), declineReason: reason };
  }

  // 7. Only thanks or an acknowledgement.
  if (isCourtesyOnly(text)) return { ...base, verdict: "acknowledged" };

  // 8. Interest.
  if (interest) return { ...base, verdict: "positive" };

  // 9. Nothing recognised.
  return needsLook("It shows no clear yes, no, question or request.");
}

function clip(words: string): string {
  const flat = words.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? `${flat.slice(0, 80)}…` : flat;
}

function sentenceAround(text: string, index: number, length: number): string {
  const start = Math.max(text.lastIndexOf("\n", index) + 1, 0);
  const endNewline = text.indexOf("\n", index + length);
  const end = endNewline === -1 ? text.length : endNewline;
  const line = text.slice(start, end).trim();
  return line.length > 200 ? `${line.slice(0, 200)}…` : line;
}

/**
 * Identifies this version of the reply rules; stored on every InboundReply.
 * Bump the revision when the logic above changes without a pattern or word
 * list changing.
 */
export const REPLY_RULES_VERSION = rulesVersion("reply", 5, [
  STOP_COMMANDS,
  FILLER_RE,
  STOP_REQUESTS,
  OTHER_CHANNEL_RE,
  EMAIL_WORD_RE,
  ASKS_ABOUT_STOPPING_BEFORE_RE,
  LATER_RE,
  STOP_CUES,
  COMPLAINTS.map(({ re, reason }) => ({ re, reason })),
  HEDGE_RE,
  REAL_QUESTION_RE,
  PLAIN_DECLINES.map(({ re, reason }) => ({ re, reason })),
  COURTESY_RE,
  GREETING_RES,
  NOT_A_NAME,
  INTEREST_SIGNALS,
  CONTACT_DETAIL_RE,
  QUESTION_RE,
  NEGATION_WORD_RE,
  NOT_A_NEGATION_RE,
  NEGATION_BEFORE_RE,
  TEMPLATE_FOOTER_RE,
  QUOTE_HEADER_PATTERNS,
  SIGNATURE_PATTERNS,
  SIGN_OFF_RE,
  POSTSCRIPT_RE,
  FOREIGN_WORDS,
  ENGLISH_WORDS,
  MIN_WORDS_FOR_LANGUAGE,
]);
