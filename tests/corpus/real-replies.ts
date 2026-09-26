// Anonymised REAL replies, for measuring the reply classifier on production
// traffic rather than on the synthetic sets beside this file. Scored by
// tests/heuristics-eval.test.ts on the three outcomes the app acts on;
// while this list is empty the eval says plainly that every reply score is
// synthetic.
//
// To fill it (docs/measuring-rules.md):
//   EVAL_EXPORT_DATABASE_URL=… node scripts/export-eval-cases.mjs 200 > cases.json
// then, for each case: read it, correct `expected` (the export only
// suggests the app's own verdict), replace any person's or firm's name the
// script couldn't find, and paste it below. Never commit a real address,
// phone number or name. Aim for at least 50 cases; never change the rules
// with these in view (they are held out).

/** What the app does with a reply: suppress it, flag it for a look, or count it as a positive reply. */
export type ReplyOutcome = "opt_out" | "needs_look" | "positive" | "declined" | "acknowledged";

export type RealReplyCase = { text: string; subject?: string; expected: ReplyOutcome };

export const REAL_REPLY_HELD_OUT: RealReplyCase[] = [];
