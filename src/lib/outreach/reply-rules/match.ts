// The matchers the classifier's steps use: find a phrase from a list,
// tell a negated or later-tense mention from a real one, and quote the
// words a verdict was read from. Kept apart from the precedence in
// ../reply-classifier.ts.
import {
  ASKS_ABOUT_STOPPING_BEFORE_RE,
  isNegated,
  LATER_RE,
  normalizeCommandLine,
  STOP_COMMANDS,
  STOP_CUES,
  STOP_REQUESTS,
  stripReplyPrefix,
} from "@/lib/outreach/reply-rules/stop";
import { extractNewReplyText } from "@/lib/outreach/reply-rules/reply-text";
import {
  AFFIRMATIONS,
  CONTACT_DETAIL_RE,
  INTEREST_SIGNALS,
  NEGATION_WORD_RE,
  NOT_A_NEGATION_RE,
  QUESTION_RE,
} from "@/lib/outreach/reply-rules/interest";

export type Found = { index: number; text: string; /** How to name it in a reason, when not by quoting `text`. */ label?: string };

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

/**
 * A sign of interest not negated in its own clause (from `signals`, every
 * group by default), a number or address to use, or (optionally) a question.
 */
export function findInterest(
  text: string,
  { countQuestions, signals = INTEREST_SIGNALS }: { countQuestions: boolean; signals?: readonly RegExp[] },
): Found | null {
  const signal = firstMatch(text, signals, ({ index }) => !negatedInClause(text, index, NOT_A_NEGATION_RE));
  if (signal) return signal;
  const detail = CONTACT_DETAIL_RE.exec(text);
  if (detail) return { index: detail.index, text: detail[0], label: "gives a number or address to use" };
  if (countQuestions) {
    const question = QUESTION_RE.exec(text);
    if (question) return { index: question.index, text: question[0], label: "asks a question" };
  }
  return null;
}

/** The first of `signals` in `text` not negated in its own clause — no numbers or questions. */
export function findSignal(text: string, signals: readonly RegExp[]): Found | null {
  return firstMatch(text, signals, ({ index }) => !negatedInClause(text, index, NOT_A_NEGATION_RE));
}

/**
 * Whether `text` says yes or "interested" in so many words (not negated) —
 * a stronger sign than a question or a phone number, which out-of-office
 * messages also contain. Used to keep a reply that merely mentions being
 * out of the office from being filed as automatic (see inbound.ts).
 */
export function showsClearInterest(text: string): boolean {
  const own = extractNewReplyText(text).replace(/[‘’ʼ]/g, "'");
  return firstMatch(own, AFFIRMATIONS, ({ index }) => !negatedInClause(own, index, null)) !== null;
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
export function findStopRequest(text: string, subject: string): Found | null {
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
export function findStopCue(text: string): Found | null {
  return firstMatch(text, STOP_CUES, ({ index, text: words }) => {
    // "Don't hesitate to email me" isn't a negation; otherwise the
    // negated-contact cue carries its own negation.
    if (new RegExp(`^${NOT_A_NEGATION_RE.source}`, "i").test(words)) return false;
    if (/^(?:not|never|don|dont|didn|did|do|nor|no)\b/i.test(words)) return true;
    return !isNegated(text, index);
  });
}

/** The first phrase from `phrases` in `text`, with where it was found. */
export function findPhrase<T extends { re: RegExp }>(text: string, phrases: readonly T[]): (Found & { phrase: T }) | null {
  let best: (Found & { phrase: T }) | null = null;
  for (const phrase of phrases) {
    const match = phrase.re.exec(text);
    if (match && (!best || match.index < best.index)) best = { index: match.index, text: match[0], phrase };
  }
  return best;
}

/** `text` with the clause holding `found` blanked out (same length), so what's left can be searched for anything else. */
export function withoutClause(text: string, found: Found): string {
  if (found.index < 0) return text;
  const clauseStart = Math.max(
    ...[".", "!", "?", ";", ",", "\n", "—", "–"].map((c) => text.lastIndexOf(c, found.index - 1) + 1),
    text.lastIndexOf(" but ", found.index) + 1,
    0,
  );
  const end = found.index + found.text.length;
  return text.slice(0, clauseStart) + " ".repeat(end - clauseStart) + text.slice(end);
}

export function clip(words: string): string {
  const flat = words.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? `${flat.slice(0, 80)}…` : flat;
}

export function sentenceAround(text: string, index: number, length: number): string {
  const start = Math.max(text.lastIndexOf("\n", index) + 1, 0);
  const endNewline = text.indexOf("\n", index + length);
  const end = endNewline === -1 ? text.length : endNewline;
  const line = text.slice(start, end).trim();
  return line.length > 200 ? `${line.slice(0, 200)}…` : line;
}
