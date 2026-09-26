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
import { REPLY_CORPUS, REPLY_HELD_OUT, REPLY_UNLISTED_HELD_OUT } from "./corpus/replies";
import { ADDRESS_CORPUS, ADDRESS_HELD_OUT } from "./corpus/addresses";
import { AUTO_REPLY_DEV, AUTO_REPLY_HELD_OUT, BOUNCE_DEV, BOUNCE_HELD_OUT } from "./corpus/auto-mail";
import { REVIEW_DEV, REVIEW_HELD_OUT, REVIEW_UNLISTED_HELD_OUT } from "./corpus/review";
import { REAL_REPLY_HELD_OUT, type ReplyOutcome } from "./corpus/real-replies";
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

describe("heuristics on the labelled evaluation sets", () => {
  // Opt-out detection: a missed opt-out means emailing someone who asked us
  // to stop, so recall matters most; a false opt-out only loses one prospect.
  it(`reply opt-out classifier (${REPLY_CORPUS.length} dev, ${REPLY_HELD_OUT.length} + ${REPLY_UNLISTED_HELD_OUT.length} held-out)`, () => {
    expect(REPLY_CORPUS.length).toBeGreaterThanOrEqual(100);
    const run = (cases: typeof REPLY_CORPUS) =>
      cases.map((c) => ({
        expected: c.optOut,
        actual: classifyReply({ subject: c.subject ?? "Re: hello", text: c.text }).optOut,
        label: (c.subject ? `[${c.subject}] ` : "") + firstLine(c.text),
      }));
    const words = { fp: "false opt-out", fn: "missed opt-out" };
    evaluate("Reply opt-outs", "dev", run(REPLY_CORPUS), { precision: 0.95, recall: 0.95 }, words);
    evaluate("Reply opt-outs", "held-out", run(REPLY_HELD_OUT), { precision: 0.95, recall: 0.95 }, words);
    // Round 9 (26 cases): 50.0% / 11.8% before the rule change, 94.4% / 100% after.
    evaluate("Reply opt-outs", "held-out, unlisted phrasings", run(REPLY_UNLISTED_HELD_OUT), { precision: 0.9, recall: 0.95 }, words);
  });

  // "Not counted as a positive reply" (flagged for a look, or an opt-out):
  // a miss moves a brush-off to Responded (inflating the reply rate, and
  // the operator may phone someone who declined); a false flag only asks
  // the operator to glance at a real yes.
  it(`reply "needs a look" flag (${REVIEW_DEV.length} dev, ${REVIEW_HELD_OUT.length} + ${REVIEW_UNLISTED_HELD_OUT.length} held-out)`, () => {
    const run = (cases: typeof REVIEW_DEV) =>
      cases.map((c) => {
        const verdict = classifyReply({ subject: "Re: hello", text: c.text });
        return { expected: c.review, actual: verdict.optOut || verdict.review !== null, label: firstLine(c.text) };
      });
    const words = { fp: "flagged a positive reply", fn: "missed a brush-off" };
    evaluate("Needs-a-look replies", "dev", run(REVIEW_DEV), { precision: 0.95, recall: 0.95 }, words);
    // Raised from 0.85/0.85 in round 7 (measured 97.8% / 100% on 78 cases).
    evaluate("Needs-a-look replies", "held-out", run(REVIEW_HELD_OUT), { precision: 0.9, recall: 0.9 }, words);
    // Round 9 (44 cases): 100% / 8.3% before a positive signal was required, 100% / 100% after.
    evaluate("Needs-a-look replies", "held-out, unlisted phrasings", run(REVIEW_UNLISTED_HELD_OUT), { precision: 0.9, recall: 0.9 }, words);
  });

  // Anonymised real replies (tests/corpus/real-replies.ts), scored on the
  // three outcomes the app acts on. Until the owner supplies some, every
  // score above is on synthetic cases only — the run says so.
  it(`reply outcomes on real replies (${REAL_REPLY_HELD_OUT.length} held-out)`, () => {
    if (REAL_REPLY_HELD_OUT.length === 0) {
      console.log(
        "Real replies [held-out]: none yet — every score above is on SYNTHETIC cases written by the rules' author. " +
          "See README → “Measuring the reply and address rules” to add anonymised real replies.",
      );
      return;
    }
    const outcome = (text: string, subject?: string): ReplyOutcome => {
      const verdict = classifyReply({ subject: subject ?? "Re: hello", text });
      return verdict.optOut ? "opt_out" : verdict.review ? "needs_look" : "positive";
    };
    const results = REAL_REPLY_HELD_OUT.map((c) => ({ ...c, actual: outcome(c.text, c.subject) }));
    const right = results.filter((r) => r.actual === r.expected).length;
    const missedOptOuts = results.filter((r) => r.expected === "opt_out" && r.actual !== "opt_out").length;
    console.log(
      [
        `Real replies [held-out, ${results.length} cases${results.length < 50 ? " — fewer than 50, read as indicative only" : ""}]: ` +
          `${pct(right / results.length)} right, ${missedOptOuts} missed opt-out(s)`,
        ...results
          .filter((r) => r.actual !== r.expected)
          .map((r) => `  miss: expected ${r.expected}, got ${r.actual}: ${firstLine(r.text)}`),
      ].join("\n"),
    );
    expect(missedOptOuts, "missed opt-outs on real replies").toBe(0);
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
