// THE FROZEN HELD-OUT SET for the reply classifier: anonymised REAL replies
// that no rule has ever been written or tuned against.
//
// Rules for this file:
// - Cases come only from scripts/export-eval-cases.mjs, and only those the
//   export assigns to "held-out" (by the case's `id`, a hash of its
//   exported text). tests/heuristics-eval.test.ts fails if a case's id
//   assigns it to "dev". Never write a case for this file by hand.
// - Add only newly exported cases. Never edit, relabel or remove a case
//   once it is here (except to anonymise it further), and never change a
//   rule while looking at a case here: fix a rule from a development case
//   (tests/corpus/real-replies.ts, tests/corpus/replies.ts) or new traffic.
// - The eval reports this set ONLY as aggregate scores (counts per outcome,
//   unsafe count, share needing a look); it never prints a case or a miss
//   from it, so CI logs don't turn it into development data. To see why a
//   held-out score moved, add fresh development cases of the same kind.
//
// Before adding a case: correct `expected` (the export suggests the app's
// own verdict), replace any person's or firm's name the anonymiser missed
// (keep the `id` as exported), and never commit a real address, phone
// number or name. Aim for at least 50 cases before quoting the score.

import type { RealReplyCase } from "../real-replies";

export const HELD_OUT_REPLIES: RealReplyCase[] = [];
