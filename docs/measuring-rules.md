# Measuring the reply and address rules

`tests/heuristics-eval.test.ts` scores each heuristic on labelled sets kept apart from the unit-test cases
and fails the run (and CI) when a score drops below its floor.

| Heuristic | Development sets | What a miss costs |
| --- | --- | --- |
| Reply classifier (opt-out / positive / plain no / thank-you only / needs a look) | `tests/corpus/replies.ts`, `review.ts`, `replies-dev-r10.ts`, `replies-dev-r11.ts` (synthetic), `real-replies.ts` (real) | An opt-out or a "no" counted as a yes, or an interested reply suppressed (these are **unsafe** and must be 0); an opt-out or an interested reply read as a plain no or a thank-you (must also be 0); otherwise only operator time |
| Automatic-reply detector | `tests/corpus/auto-mail.ts` | A real reply hidden, or an out-of-office counted as a reply |
| Bounce detector (and the failed address) | `tests/corpus/auto-mail.ts` | Someone else's send marked bounced (precision first) |
| Brokerage-site address rule | `tests/corpus/addresses.ts` | Pitching the wrong agent (precision first) |
| Guessed-site acceptance | `tests/corpus/sites.ts` | Pitching the wrong business (precision first) |

## Development sets and the frozen held-out set

- **Development** — every synthetic batch, and the real replies in `tests/corpus/real-replies.ts`. Use them
  freely while changing a rule; the run prints them case by case, with every miss. The synthetic batches
  were written by the rules' author and have been printed on every CI run, so their scores are optimistic.
  Batches that used to be called "held-out" (named by round) are development batches now: they had been
  read and tuned against round after round.
- **Held-out** — `tests/corpus/held-out/replies.ts`: real, anonymised replies exported by
  `scripts/export-eval-cases.mjs` into the held-out split, frozen once added. It is reported **only in
  aggregate** (counts per outcome, unsafe count, share needing a look), never case by case — not even when
  it fails — and it is scored on its own, so adding a development case never changes its numbers. Never
  write a case for it by hand, never edit or relabel one, and never change a rule while looking at one: fix
  a rule from a development case or new traffic. **Quote this score** once it has 50 or more cases. Until
  the owner exports some it is empty, and the run says so ("Reply outcomes [HELD-OUT, real]: none yet").

Which split a real case goes in is not a choice: the export gives each case an `id` (a hash of its exported
text) and the split that id assigns (`scripts/eval-split.mjs`: about 40% dev, 60% held-out), and the eval
fails if a case sits in the wrong file. Every printed line says whether its numbers come from **real** or
**synthetic** replies, and the CI run summary lists the two apart.

The reply classifier is scored on outcomes rather than precision and recall. For each set the run prints
how many replies land on **needs a look** (the operator's workload), how many opt-outs were suppressed and
how many interested replies were counted without the operator, and every **unsafe** outcome: an opt-out or
a decline counted as a positive reply, or a reply that isn't an opt-out suppressed. Any unsafe outcome on
any set fails the run, and so does an opt-out or an interested reply read as a plain no or a thank-you
(those hold the address but would neither suppress it nor count the reply); so does a drop below the floors
on what the rules handle alone across the synthetic batches (at least 90% of opt-outs suppressed and 90% of
interested replies counted automatically, at most 30% of replies needing a look). The older batches were
labelled on one question each (opt-out or not; positive or not), so they are scored on that question only.

**Round 14 (2026-10-05).** The review found deferrals and gatekeeper forwards counted as interested replies
("Sounds great but not right now, maybe next quarter", "Perfect timing actually but our budget is frozen
till 2027", "Thank you, I will pass this on to the owner.", "I will think about it"). Those phrasings and
similar ones are development cases now, labelled needs a look; eight older cases that only say the email is
being passed on or will be read were relabelled from positive to needs a look under the same rule (marked
in the corpus). Across the synthetic batches the round-14 rules give 0 unsafe outcomes, 214 of 224 opt-outs
suppressed and 100 of 104 interested replies counted automatically, and 185 of 649 replies (28.5%) needing
a look.

The other heuristics print precision and recall per batch, each with a floor. Their second batches (formerly
"held-out") are development data for the same reason as the reply batches; a genuinely unseen measure for
them needs real cases.

## Adding real replies

Export recent inbound mail with its anonymised text and the app's decision as a *suggested* label:

```bash
EVAL_EXPORT_DATABASE_URL="<read-only URL or a copy of production>" node scripts/export-eval-cases.mjs 200 > cases.json
```

The script runs one `SELECT` in a read-only transaction and replaces email addresses, phone numbers, URLs
and long digit runs. Each case comes out in the shape the corpus takes (`id`, `text`, `subject`,
`expected`), with `expected` set to what the app decided and `split` naming its file: `"dev"` →
`REAL_REPLY_DEV` in `tests/corpus/real-replies.ts`, `"held-out"` → `HELD_OUT_REPLIES` in
`tests/corpus/held-out/replies.ts`. It can't find people's or firms' names in free text: replace those by
hand (keep the `id` as exported), read and correct each `expected`, drop `split` and the `suggested`
details, and paste each case into its file. Replies to the reply-loop check (the owner's own test replies)
are left out of the export. Never commit real addresses or names. Aim for 50 or more held-out cases.

**Rules version.** Every stored decision records which version of the rules made it:
`InboundReply.rulesVersion` (the reply kind, opt-out and "needs a look" verdicts) and the leads'
`emailRulesVersion` (the address and guessed-site rules that accepted a found address; empty for addresses
entered or checked by hand). The version is a hash of the rules' patterns and word lists plus a revision
number (`src/lib/outreach/rules-version.ts`): editing a pattern or list changes it automatically; bump the
module's revision when only the logic around them changes. The export script includes it, so a change in
accuracy can be traced to the rule change that caused it.

In production, the **Unmatched replies** page shows how often the operator corrects the rules (last 90 days):
opt-outs read from replies and how many were undone, opt-outs the rules missed (a reply later marked opted
out by hand), replies flagged for a look (and how many said "wrong person"), plain no's closed
automatically and how many were reopened (moved back to Responded), thank-you-only replies and how many
were then marked replied, and found addresses that bounced. These are recorded in `OutreachCorrection`,
with the version of the rules whose decision was corrected (`rulesVersion`).

**How found addresses are doing** (Unmatched replies page, `src/lib/outreach/finder-quality.ts`) shows the email
finder on real mail, per pipeline and per `emailRulesVersion`, over the last 90 days: leads emailed and
sends, bounces, replies saying "wrong person" or "no longer works here", and found addresses the operator
replaced before the pitch (an `address_corrected` correction) — next to the same figures for addresses
typed in or checked by hand, as a baseline. Compare a new rules version's row with the previous one's once
it has a few dozen sends; the labelled sets above say whether a change should help, and this says whether
it did.
