// Scores the two heuristics that decide who is pitched and who has opted
// out against labelled sets kept apart from the unit-test cases
// (tests/corpus/). Prints precision and recall, lists every miss, and fails
// if either drops below its floor — so a rule change that makes things
// worse fails CI even when every hand-written unit test still passes.
//
// The floors sit a little under the scores measured when they were set (see
// the corpus files for the first-run numbers). Raise them as the rules
// improve; lowering one needs a reason in the commit message.
import { describe, expect, it } from "vitest";
import { classifyReply } from "@/lib/outreach/reply-classifier";
import { addressFilterFor } from "@/lib/outreach/email-policy";
import { REPLY_CORPUS } from "./corpus/replies";
import { ADDRESS_CORPUS } from "./corpus/addresses";

type Score = { precision: number; recall: number; tp: number; fp: number; fn: number; tn: number };

function score(results: { expected: boolean; actual: boolean }[]): Score {
  let tp = 0, fp = 0, fn = 0, tn = 0; // prettier-ignore
  for (const { expected, actual } of results) {
    if (actual && expected) tp++;
    else if (actual && !expected) fp++;
    else if (!actual && expected) fn++;
    else tn++;
  }
  return { precision: tp + fp === 0 ? 1 : tp / (tp + fp), recall: tp + fn === 0 ? 1 : tp / (tp + fn), tp, fp, fn, tn };
}

function report(name: string, s: Score, misses: string[]) {
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  console.log(
    [
      `${name}: precision ${pct(s.precision)}, recall ${pct(s.recall)} (tp ${s.tp}, fp ${s.fp}, fn ${s.fn}, tn ${s.tn})`,
      ...misses.map((m) => `  miss: ${m}`),
    ].join("\n"),
  );
}

// Opt-out detection: a missed opt-out means emailing someone who asked us
// to stop, so recall matters most; a false opt-out only loses one prospect.
const REPLY_FLOOR = { precision: 0.95, recall: 0.95 };
// Brokerage-site addresses: a false accept pitches the wrong person (and
// uses up their one pitch), so precision matters most.
const ADDRESS_FLOOR = { precision: 0.95, recall: 0.9 };

describe("heuristics on the labelled evaluation sets", () => {
  it(`reply opt-out classifier (${REPLY_CORPUS.length} replies)`, () => {
    const results = REPLY_CORPUS.map((c) => ({ ...c, actual: classifyReply({ subject: c.subject ?? "Re: hello", text: c.text }).optOut }));
    const s = score(results.map((r) => ({ expected: r.optOut, actual: r.actual })));
    const misses = results
      .filter((r) => r.actual !== r.optOut)
      .map((r) => `${r.optOut ? "missed opt-out" : "false opt-out"}: ${JSON.stringify((r.subject ? `[${r.subject}] ` : "") + r.text.split("\n")[0])}`);
    report("Reply opt-outs", s, misses);
    expect(REPLY_CORPUS.length).toBeGreaterThanOrEqual(100);
    expect(s.recall).toBeGreaterThanOrEqual(REPLY_FLOOR.recall);
    expect(s.precision).toBeGreaterThanOrEqual(REPLY_FLOOR.precision);
  });

  it(`brokerage-site address filter (${ADDRESS_CORPUS.length} agent/address pairs)`, () => {
    const results = ADDRESS_CORPUS.map((c) => ({ ...c, actual: addressFilterFor(c.agent, "brokerage")(c.email) }));
    const s = score(results.map((r) => ({ expected: r.belongs, actual: r.actual })));
    const misses = results
      .filter((r) => r.actual !== r.belongs)
      .map((r) => `${r.belongs ? "rejected own address" : "accepted someone else's"}: ${r.agent} <${r.email}>`);
    report("Brokerage addresses", s, misses);
    expect(s.precision).toBeGreaterThanOrEqual(ADDRESS_FLOOR.precision);
    expect(s.recall).toBeGreaterThanOrEqual(ADDRESS_FLOOR.recall);
  });
});
