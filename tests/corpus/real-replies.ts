// Anonymised REAL replies, for measuring the reply classifier on production
// traffic rather than on the synthetic sets beside this file. Scored by
// tests/heuristics-eval.test.ts on the outcomes the app acts on, each split
// on its own line, with the same safety floor as the synthetic sets; while
// the lists are empty the eval says plainly that every reply score is
// synthetic.
//
// To fill them (docs/measuring-rules.md):
//   EVAL_EXPORT_DATABASE_URL=… node scripts/export-eval-cases.mjs 200 > cases.json
// then, for each case: read it, correct `expected` (the export only
// suggests the app's own verdict), replace any person's or firm's name the
// script couldn't find, and paste it into the split the export assigned it
// (`split`: a fixed hash of the text, so nobody picks which cases are held
// out). Never commit a real address, phone number or name. Aim for at
// least 50 held-out cases.
//
// - REAL_REPLY_DEV: real replies a rule change may be written against.
// - REAL_REPLY_HELD_OUT: never looked at while changing a rule; a miss here
//   is recorded, and fixed only from a development case or new traffic.

/** What the app does with a reply: suppress it, flag it for a look, or count it as a positive reply. */
export type ReplyOutcome = "opt_out" | "needs_look" | "positive" | "declined" | "acknowledged";

export type RealReplyCase = { text: string; subject?: string; expected: ReplyOutcome };

export const REAL_REPLY_DEV: RealReplyCase[] = [];

export const REAL_REPLY_HELD_OUT: RealReplyCase[] = [];
