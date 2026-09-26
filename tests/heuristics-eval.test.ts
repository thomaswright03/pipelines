// Scores every heuristic that decides who is pitched, who has opted out and
// what a reply means, against labelled sets kept apart from the unit-test
// cases (tests/corpus/). For each heuristic it prints precision and recall
// on the development split (cases the rules were written against) and on
// the held-out split (written separately, scored as-is, never used when
// changing a rule), lists every miss, and fails if either split drops below
// its floor — so a rule change that makes things worse fails CI even when
// every hand-written unit test still passes.
//
// Floors sit at or a little under the scores measured when they were set.
// Raise them as the rules improve; lowering one needs a reason in the
// commit message. The held-out score is the one to quote: the development
// score is optimistic by construction.
import { describe, expect, it } from "vitest";
import { classifyReply } from "@/lib/outreach/reply-classifier";
import { addressFilterFor } from "@/lib/outreach/email-policy";
import { detectAutoReply, detectBounce } from "@/lib/outreach/auto-mail";
import { siteEvidence } from "@/lib/outreach/site-evidence";
import { REPLY_CORPUS, REPLY_DEV_OUTCOMES, REPLY_HELD_OUT, REPLY_UNLISTED_HELD_OUT } from "./corpus/replies";
import { ADDRESS_CORPUS, ADDRESS_HELD_OUT } from "./corpus/addresses";
import { AUTO_REPLY_DEV, AUTO_REPLY_HELD_OUT, BOUNCE_DEV, BOUNCE_HELD_OUT } from "./corpus/auto-mail";
import { REVIEW_DEV, REVIEW_HELD_OUT, REVIEW_UNLISTED_HELD_OUT } from "./corpus/review";
import { REAL_REPLY_HELD_OUT, type ReplyOutcome } from "./corpus/real-replies";
import { REPLY_HELD_OUT_R10 } from "./corpus/replies-held-out-r10";
import { REPLY_HELD_OUT_R11 } from "./corpus/replies-held-out-r11";
import { SITE_DEV, SITE_HELD_OUT } from "./corpus/sites";

type Score = { precision: number; recall: number; tp: number; fp: number; fn: number; tn: number };
type Floor = { precision: number; recall: number };
type Case = { expected: boolean; actual: boolean; label: string };

function score(results: Case[]): Score {
  let tp = 0, fp = 0, fn = 0, tn = 0; // prettier-ignore
  for (const { expected, actual } of results) {
    if (actual && expected) tp++;
    else if (actual && !expected) fp++;
    else if (!actual && expected) fn++;
    else tn++;
  }
  return { precision: tp + fp === 0 ? 1 : tp / (tp + fp), recall: tp + fn === 0 ? 1 : tp / (tp + fn), tp, fp, fn, tn };
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/** Scores one split, prints it with its misses, and checks it against its floor. */
function evaluate(
  name: string,
  split: "dev" | "held-out" | "held-out, unlisted phrasings",
  results: Case[],
  floor: Floor,
  words: { fp: string; fn: string },
) {
  const s = score(results);
  const misses = results.filter((r) => r.actual !== r.expected).map((r) => `  miss: ${r.expected ? words.fn : words.fp}: ${r.label}`);
  console.log(
    [
      `${name} [${split}, synthetic]: precision ${pct(s.precision)}, recall ${pct(s.recall)} (tp ${s.tp}, fp ${s.fp}, fn ${s.fn}, tn ${s.tn})`,
      ...misses,
    ].join("\n"),
  );
  expect(s.precision, `${name} [${split}] precision`).toBeGreaterThanOrEqual(floor.precision);
  expect(s.recall, `${name} [${split}] recall`).toBeGreaterThanOrEqual(floor.recall);
}

const firstLine = (text: string) => JSON.stringify(text.split("\n")[0]);

/**
 * What a labelled reply is. The older sets were labelled on one question
 * only: "not_opt_out" (anything but an opt-out) and "needs_look" (a decline
 * or complaint, never an opt-out) come from them.
 */
type Intent = ReplyOutcome | "not_opt_out";
type IntentCase = { text: string; subject?: string; intent: Intent };
type Verdict = ReturnType<typeof classifyReply>["verdict"];
type ReplySplitScore = {
  name: string;
  total: number;
  /** Replies per verdict. */
  verdicts: Record<string, number>;
  optOuts: number;
  autoOptOuts: number;
  positives: number;
  autoPositives: number;
  /** Opt-outs the rules held (declined/acknowledged) instead of suppressing: never emailed again, but not on the list. */
  optOutsHeldOnly: string[];
  /** Interested replies closed as a decline or filed as a courtesy note. */
  positivesMissed: string[];
  unsafe: string[];
};

/**
 * An outcome the app must never reach for a reply of this intent: an
 * opt-out, a decline or a complaint counted as a positive reply, or a reply
 * that doesn't ask to stop suppressed as an opt-out. "needs_look",
 * "declined" and "acknowledged" all hold every email to the address, so
 * none of them can email someone who asked to stop.
 */
function isUnsafe(intent: Intent, verdict: Verdict): boolean {
  if (verdict === "opt_out") return intent !== "opt_out";
  if (verdict === "positive") return intent === "opt_out" || intent === "needs_look" || intent === "declined";
  return false;
}

/** Scores one split of labelled replies on the app's outcomes, and prints it with every unsafe, missed or needs-a-look case. */
function scoreReplies(name: string, cases: IntentCase[]): ReplySplitScore {
  const result: ReplySplitScore = {
    name,
    total: cases.length,
    verdicts: { opt_out: 0, positive: 0, declined: 0, acknowledged: 0, needs_look: 0 },
    optOuts: 0,
    autoOptOuts: 0,
    positives: 0,
    autoPositives: 0,
    optOutsHeldOnly: [],
    positivesMissed: [],
    unsafe: [],
  };
  const lines: string[] = [];
  for (const c of cases) {
    const verdict = classifyReply({ subject: c.subject ?? "Re: hello", text: c.text }).verdict;
    const label = (c.subject ? `[${c.subject}] ` : "") + firstLine(c.text);
    result.verdicts[verdict] = (result.verdicts[verdict] ?? 0) + 1;
    if (c.intent === "opt_out") {
      result.optOuts++;
      if (verdict === "opt_out") result.autoOptOuts++;
      if (verdict === "declined" || verdict === "acknowledged") {
        result.optOutsHeldOnly.push(label);
        lines.push(`  held, not suppressed: opt_out read as ${verdict}: ${label}`);
      }
    }
    if (c.intent === "positive") {
      result.positives++;
      if (verdict === "positive") result.autoPositives++;
      if (verdict === "declined" || verdict === "acknowledged") {
        result.positivesMissed.push(label);
        lines.push(`  interest missed: positive read as ${verdict}: ${label}`);
      }
    }
    if (isUnsafe(c.intent, verdict)) {
      result.unsafe.push(label);
      lines.push(`  UNSAFE: ${c.intent} read as ${verdict}: ${label}`);
    } else if (verdict === "needs_look" && c.intent !== "needs_look") {
      lines.push(`  needs a look: ${c.intent}: ${label}`);
    } else if (
      verdict !== c.intent &&
      (["declined", "acknowledged"].includes(c.intent) || ["declined", "acknowledged"].includes(verdict))
    ) {
      lines.push(`  other: ${c.intent} read as ${verdict}: ${label}`);
    }
  }
  const rate = (n: number, d: number) => (d === 0 ? "—" : `${n} of ${d} (${pct(n / d)})`);
  const v = result.verdicts;
  console.log(
    [
      `Reply outcomes [${name}, synthetic]: ${result.total} replies; unsafe ${result.unsafe.length}; ` +
        `needs a look ${rate(v.needs_look!, result.total)}; declined ${v.declined}, acknowledged ${v.acknowledged}; ` +
        `opt-outs suppressed automatically ${rate(result.autoOptOuts, result.optOuts)}; ` +
        `interested replies counted automatically ${rate(result.autoPositives, result.positives)}; ` +
        `opt-outs held but not suppressed ${result.optOutsHeldOnly.length}; interested replies closed or filed ${result.positivesMissed.length}`,
      ...lines,
    ].join("\n"),
  );
  return result;
}

describe("heuristics on the labelled evaluation sets", () => {
  // The reply classifier acts on its own only when it is confident; anything
  // else goes to "needs a look" (the operator decides, and nothing is
  // emailed to the address meanwhile). So each split is scored on:
  // - UNSAFE outcomes, which must stay at zero: an opt-out or a decline
  //   counted as a positive reply, or a reply that isn't an opt-out
  //   suppressed as one;
  // - how much the rules handle by themselves: opt-outs suppressed, and
  //   interested replies counted, automatically;
  // - how many replies land on "needs a look" — the operator's workload.
  it(`reply classifier outcomes (${REPLY_CORPUS.length + REVIEW_DEV.length + REPLY_DEV_OUTCOMES.length} dev, ${
    REPLY_HELD_OUT.length +
    REPLY_UNLISTED_HELD_OUT.length +
    REVIEW_HELD_OUT.length +
    REVIEW_UNLISTED_HELD_OUT.length +
    REPLY_HELD_OUT_R10.length +
    REPLY_HELD_OUT_R11.length
  } held-out)`, () => {
    expect(REPLY_CORPUS.length).toBeGreaterThanOrEqual(100);
    const fromOptOutLabels = (cases: typeof REPLY_CORPUS): IntentCase[] =>
      cases.map((c) => ({ text: c.text, subject: c.subject, intent: c.optOut ? "opt_out" : "not_opt_out" }));
    const fromReviewLabels = (cases: typeof REVIEW_DEV): IntentCase[] =>
      cases.map((c) => ({ text: c.text, intent: c.review ? "needs_look" : "positive" }));
    const fromOutcomes = (cases: { text: string; subject?: string; expected: ReplyOutcome }[]): IntentCase[] =>
      cases.map((c) => ({ text: c.text, subject: c.subject, intent: c.expected }));

    const dev = scoreReplies("dev", [
      ...fromOptOutLabels(REPLY_CORPUS),
      ...fromReviewLabels(REVIEW_DEV),
      ...fromOutcomes(REPLY_DEV_OUTCOMES),
    ]);
    const heldOut = [
      scoreReplies("held-out, rounds 5-7 opt-out labels", fromOptOutLabels(REPLY_HELD_OUT)),
      scoreReplies("held-out, round 9 unlisted opt-out phrasings", fromOptOutLabels(REPLY_UNLISTED_HELD_OUT)),
      scoreReplies("held-out, rounds 5-7 decline labels", fromReviewLabels(REVIEW_HELD_OUT)),
      scoreReplies("held-out, round 9 unlisted declines", fromReviewLabels(REVIEW_UNLISTED_HELD_OUT)),
      scoreReplies("held-out, round 10 batch", fromOutcomes(REPLY_HELD_OUT_R10)),
      scoreReplies("held-out, round 11 batch", fromOutcomes(REPLY_HELD_OUT_R11)),
    ];
    const all = [dev, ...heldOut];

    // Never an unsafe outcome, on any split.
    for (const split of all) expect(split.unsafe, `unsafe outcomes on the ${split.name} split`).toEqual([]);
    // A plain no or a courtesy note holds the address but acts on nothing
    // else; it must never swallow an opt-out (which must be suppressed) or
    // an interested reply (which must be counted). Zero on every split.
    for (const split of all) {
      expect(split.optOutsHeldOnly, `opt-outs read as a plain no or a thank-you on the ${split.name} split`).toEqual([]);
      expect(split.positivesMissed, `interested replies read as a plain no or a thank-you on the ${split.name} split`).toEqual([]);
    }
    // Floors on what the rules handle alone, a little under the scores
    // measured on 2026-09-26 (round 11: 25.7% of held-out replies need a
    // look, down from 40.3% with the round-10 rules), so the rules can't
    // quietly slide back into sending everything to the operator. Lowering
    // one needs a reason in the commit message.
    const sum = (key: "optOuts" | "autoOptOuts" | "positives" | "autoPositives" | "total" | "needsLook") =>
      heldOut.reduce((n, split) => n + (key === "needsLook" ? split.verdicts.needs_look! : split[key]), 0);
    expect(sum("autoOptOuts") / sum("optOuts"), "held-out opt-outs suppressed automatically").toBeGreaterThanOrEqual(0.75);
    expect(sum("autoPositives") / sum("positives"), "held-out interested replies counted automatically").toBeGreaterThanOrEqual(0.75);
    expect(sum("needsLook") / sum("total"), "held-out share of replies needing a look").toBeLessThanOrEqual(0.3);
    console.log(
      `Reply outcomes [held-out, all splits, synthetic]: ${sum("total")} replies — ${sum("needsLook")} (${pct(sum("needsLook") / sum("total"))}) need a look; ` +
        `${sum("autoOptOuts")} of ${sum("optOuts")} opt-outs suppressed automatically, ${sum("autoPositives")} of ${sum("positives")} interested replies counted automatically; 0 unsafe.`,
    );
  });

  // Anonymised real replies (tests/corpus/real-replies.ts), scored on the
  // three outcomes the app acts on. Until the owner supplies some, every
  // score above is on synthetic cases only — the run says so.
  it(`reply outcomes on real replies (${REAL_REPLY_HELD_OUT.length} held-out)`, () => {
    if (REAL_REPLY_HELD_OUT.length === 0) {
      console.log(
        "Real replies [held-out]: none yet — every reply score above is on SYNTHETIC cases written by the rules' author. " +
          "See docs/measuring-rules.md to add anonymised real replies.",
      );
      return;
    }
    const split = scoreReplies(
      `real replies${REAL_REPLY_HELD_OUT.length < 50 ? " (fewer than 50, read as indicative only)" : ""}`,
      REAL_REPLY_HELD_OUT.map((c) => ({ text: c.text, subject: c.subject, intent: c.expected })),
    );
    expect(split.unsafe, "unsafe outcomes on real replies").toEqual([]);
  });

  // Automatic replies: a false "automatic" hides a real reply (the lead
  // still reaches the call deck, and the history note says how to undo it),
  // so precision matters most; a miss inflates the reply rate.
  it(`automatic-reply detector (${AUTO_REPLY_DEV.length} dev, ${AUTO_REPLY_HELD_OUT.length} held-out)`, () => {
    const run = (cases: typeof AUTO_REPLY_DEV) =>
      cases.map((c) => ({ expected: c.auto, actual: detectAutoReply(c) !== null, label: `[${c.subject}] ${firstLine(c.text)}` }));
    const words = { fp: "read a person's reply as automatic", fn: "missed an automatic reply" };
    evaluate("Automatic replies", "dev", run(AUTO_REPLY_DEV), { precision: 1, recall: 0.95 }, words);
    // Raised in round 7 from 0.9 / 0.85 (measured 100% / 100% on 64 cases
    // after the fixes; see the corpus header).
    evaluate("Automatic replies", "held-out", run(AUTO_REPLY_HELD_OUT), { precision: 0.95, recall: 0.9 }, words);
  });

  // Bounces: detection and the failed address must both be right — a
  // wrong address would mark someone else's send bounced.
  it(`bounce detector (${BOUNCE_DEV.length} dev, ${BOUNCE_HELD_OUT.length} held-out)`, () => {
    const run = (cases: typeof BOUNCE_DEV) =>
      cases.map((c) => {
        const found = detectBounce(c, ["wright-ai-solutions.com"]);
        const actual = found !== null && (!c.bounce || found.failedRecipient === c.recipient);
        return { expected: c.bounce, actual, label: `[${c.subject}] from ${c.from}${found ? ` → ${found.failedRecipient}` : ""}` };
      });
    const words = { fp: "read a person's mail as a bounce", fn: "missed a bounce or its address" };
    evaluate("Bounces", "dev", run(BOUNCE_DEV), { precision: 1, recall: 1 }, words);
    evaluate("Bounces", "held-out", run(BOUNCE_HELD_OUT), { precision: 1, recall: 1 }, words);
  });

  // Brokerage-site addresses: a false accept pitches the wrong person (and
  // uses up their one pitch), so precision matters most.
  it(`brokerage-site address filter (${ADDRESS_CORPUS.length} dev, ${ADDRESS_HELD_OUT.length} held-out)`, () => {
    const run = (cases: typeof ADDRESS_CORPUS) =>
      cases.map((c) => ({
        expected: c.belongs,
        actual: addressFilterFor(c.agent, "brokerage")(c.email),
        label: `${c.agent} <${c.email}>`,
      }));
    const words = { fp: "accepted someone else's", fn: "rejected own address" };
    evaluate("Brokerage addresses", "dev", run(ADDRESS_CORPUS), { precision: 0.95, recall: 0.9 }, words);
    evaluate("Brokerage addresses", "held-out", run(ADDRESS_HELD_OUT), { precision: 0.95, recall: 0.9 }, words);
  });

  // Guessed websites: a false accept spends the lead's one pitch on a
  // stranger, so precision matters most; a miss only means no email.
  it(`guessed-site evidence (${SITE_DEV.length} dev, ${SITE_HELD_OUT.length} held-out)`, () => {
    const run = (cases: typeof SITE_DEV) =>
      cases.map((c) => ({
        expected: c.belongs,
        actual: siteEvidence(c.website, [c.html], c.facts) !== null,
        label: `${c.facts.name} on ${c.website}: ${JSON.stringify(c.html.slice(0, 80))}`,
      }));
    const words = { fp: "accepted a site that isn't the lead's", fn: "rejected the lead's own site" };
    evaluate("Guessed sites", "dev", run(SITE_DEV), { precision: 1, recall: 1 }, words);
    evaluate("Guessed sites", "held-out", run(SITE_HELD_OUT), { precision: 1, recall: 0.9 }, words);
  });
});
