# Measuring the reply and address rules

`tests/heuristics-eval.test.ts` scores each heuristic on labelled sets kept apart from the unit-test cases
and prints its results, with every miss, for two kinds of split:

| Heuristic | Corpus | What a miss costs |
| --- | --- | --- |
| Reply classifier (opt-out / positive / needs a look) | `tests/corpus/replies.ts`, `review.ts`, `replies-held-out-r10.ts` | An opt-out or a "no" counted as a yes, or an interested reply suppressed (these are **unsafe** and must be 0); otherwise only operator time |
| Automatic-reply detector | `tests/corpus/auto-mail.ts` | A real reply hidden, or an out-of-office counted as a reply |
| Bounce detector (and the failed address) | `tests/corpus/auto-mail.ts` | Someone else's send marked bounced (precision first) |
| Brokerage-site address rule | `tests/corpus/addresses.ts` | Pitching the wrong agent (precision first) |
| Guessed-site acceptance | `tests/corpus/sites.ts` | Pitching the wrong business (precision first) |

- **dev** — cases the rules were written or fixed against. Optimistic by construction.
- **held-out** — written separately and scored once as-is; never used when changing a rule. **Quote this
  score.** A miss there is recorded in the corpus header, not patched. The one exception so far: the first
  held-out opt-out run missed 4 of 20 opt-outs, and because a missed opt-out means emailing someone who
  asked us to stop, those cases were moved to dev, the rules fixed, and fresh held-out cases written (see
  the header of `tests/corpus/replies.ts`). When a reviewer reports misses, their phrasings go to **dev**;
  a fresh held-out batch for the same family is written *before* the rules change and scored before and
  after (both scores are in the corpus headers).

The reply classifier is scored on outcomes rather than precision and recall. For each split the run prints
how many replies land on **needs a look** (the operator's workload), how many opt-outs were suppressed and
how many interested replies were counted without the operator, and every **unsafe** outcome: an opt-out or
a decline counted as a positive reply, or a reply that isn't an opt-out suppressed. Any unsafe outcome on
any split fails the run; so does a drop below the floors on what the rules handle alone (held-out: at
least 75% of opt-outs suppressed and 75% of interested replies counted automatically, at most 50% of
replies needing a look). Measured on 2026-09-26, after the round-10 redesign, across the five held-out
splits (334 synthetic replies): **0 unsafe**, 36% need a look, 107 of 118 opt-outs suppressed and 72 of 76
interested replies counted automatically. On the round-10 batch alone (60 replies written before the
redesign): 0 unsafe (the old rules had 3), 40% need a look. The older splits were labelled on one question
each (opt-out or not; positive or not), so they are scored on that question only.

The other heuristics print precision and recall. Each split has a floor; the run (and CI) fails below it,
so a rule change that makes things worse fails even when every unit test passes. CI also writes the scores
to the run summary.

Every set is **synthetic**, written to resemble real mail, sites and staff directories, and the eval labels
each score "synthetic". It also scores a **real replies** split (`tests/corpus/real-replies.ts`) on the three
outcomes the app acts on (opt-out, needs a look, positive) and fails on any unsafe outcome; that split is
empty until the owner supplies data, and the run says so ("Real replies [held-out]: none yet"). To measure
production traffic, export recent inbound mail with its anonymised text and the app's decision as a
*suggested* label:

```bash
EVAL_EXPORT_DATABASE_URL="<read-only URL or a copy of production>" node scripts/export-eval-cases.mjs 200 > cases.json
```

The script runs one `SELECT` in a read-only transaction and replaces email addresses, phone numbers, URLs
and long digit runs. Each case comes out in the shape `real-replies.ts` takes (`text`, `subject`,
`expected`), with `expected` set to what the app decided. It can't find people's or firms' names in free
text: replace those by hand, read and correct each `expected`, drop the `suggested` details, and paste the
cases into `REAL_REPLY_HELD_OUT` (aim for 50 or more). Never commit real addresses or names.

**Rules version.** Every stored decision records which version of the rules made it:
`InboundReply.rulesVersion` (the reply kind, opt-out and "needs a look" verdicts) and the leads'
`emailRulesVersion` (the address and guessed-site rules that accepted a found address; empty for addresses
entered or checked by hand). The version is a hash of the rules' patterns and word lists plus a revision
number (`src/lib/outreach/rules-version.ts`): editing a pattern or list changes it automatically; bump the
module's revision when only the logic around them changes. The export script includes it, so a change in
accuracy can be traced to the rule change that caused it.

In production, the **Replies** page shows how often the operator corrects the rules (last 90 days):
opt-outs read from replies and how many were undone, opt-outs the rules missed (a reply later marked opted
out by hand), replies flagged for a look (and how many said "wrong person"), and found addresses that
bounced. These are recorded in `OutreachCorrection`.
