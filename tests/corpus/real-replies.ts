// Anonymised REAL replies for DEVELOPMENT: real production traffic a rule
// change may be written against. Scored by tests/heuristics-eval.test.ts
// on the outcomes the app acts on, printed case by case with the same
// safety floor as the synthetic sets.
//
// The held-out real replies live apart, in tests/corpus/held-out/replies.ts
// (frozen, reported only in aggregate). Which file a case goes in is not a
// choice: scripts/export-eval-cases.mjs gives each case an `id` (a hash of
// its exported text) and the split that id assigns (about 40% "dev"), and
// the eval fails if a case sits in the wrong file.
//
// To fill it (docs/measuring-rules.md):
//   EVAL_EXPORT_DATABASE_URL=… node scripts/export-eval-cases.mjs 200 > cases.json
// then, for each "dev" case: read it, correct `expected` (the export only
// suggests the app's own verdict), replace any person's or firm's name the
// script couldn't find (keep the `id` as exported), and paste it below.
// Never commit a real address, phone number or name.

/** What the app does with a reply: suppress it, flag it for a look, count it as a positive reply, close it as a plain no, or file it as a thank-you. */
export type ReplyOutcome = "opt_out" | "needs_look" | "positive" | "declined" | "acknowledged";

/** An exported real reply: `id` is the export's (scripts/eval-split.mjs), which fixes its split. */
export type RealReplyCase = { id: string; text: string; subject?: string; expected: ReplyOutcome };

export const REAL_REPLY_DEV: RealReplyCase[] = [];
