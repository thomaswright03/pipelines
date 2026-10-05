// Round-10 batch for the reply classifier, scored on the outcomes the app
// acts on (tests/heuristics-eval.test.ts).
//
// Round 14 (2026-10-05): RE-FILED AS DEVELOPMENT DATA. Every case below has
// been printed, miss by miss, on every CI run since it was written, and read
// while later rules were changed, so it no longer measures anything unseen.
// It is scored as a development batch ("synthetic dev, round 10 batch"); the only held-out set is
// tests/corpus/held-out/replies.ts (real, exported replies, frozen).
//
// Provenance: SYNTHETIC. Written on 2026-09-26 as one batch, BEFORE the
// round-10 redesign of src/lib/outreach/reply-classifier.ts, deliberately
// covering formal, abbreviated, footer- and signature-bearing phrasings and
// replies that mix opt-out words with interest. The same author then wrote
// the new rules, so this batch is less independent than real mail; it was
// scored once and is never edited (a miss is recorded, not fixed by changing
// the rules with these cases in view).
//
// `expected` is what a careful operator would want the app to do:
//   opt_out    — the sender asks not to be emailed/contacted
//   positive   — the sender is interested (a yes, a question, a request)
//   needs_look — neither: a decline, a complaint, or genuinely ambiguous
// The eval also checks that no case lands on an UNSAFE outcome: an opt-out
// counted as positive, or anything that isn't an opt-out suppressed.
//
// Scores, 60 cases (28 opt_out, 22 positive, 10 needs_look), recorded once:
// - Round-9 rules (before the redesign): 48 of 60 as expected, and THREE
//   UNSAFE outcomes — interested replies suppressed as opt-outs ("Yes!" above
//   a newsletter footer, "I'd unsubscribe from my current provider … Price?",
//   "Stop! Yes, this is what we've been looking for. Call me…"); 8 opt-outs
//   and 1 interested reply went to needs_look.
// - Round-10 redesign, first run: 47 of 60 as expected, NO unsafe outcome.
//   18 of 28 opt-outs were suppressed automatically and 10 went to
//   needs_look; 19 of 22 interested replies counted as positive and 3 went
//   to needs_look; all 10 declines went to needs_look. 23 of 60 replies (38%)
//   need the operator. One of those opt-outs ("Do not add me to any lists.")
//   gets the generic reason rather than "may be asking not to be emailed".
// - Final round-10 rules (after two unsafe development cases were fixed by
//   narrowing "unsubscribe" and "don't email me …" to explicit requests):
//   46 of 60 as expected, still no unsafe outcome; "Please don't email me
//   going forward." moved from opt_out to needs_look ("forward" reads as
//   forwarding the email). Recorded, not fixed.

import type { ReplyOutcome } from "./real-replies";

export type OutcomeCase = { text: string; subject?: string; expected: ReplyOutcome };

const LEGAL_FOOTER = [
  "",
  "CONFIDENTIALITY NOTICE: This e-mail message, including any attachments, is for the sole use of the intended recipient(s)",
  "and may contain confidential and privileged information. Any unauthorized review, use, disclosure or distribution is",
  "prohibited. If you are not the intended recipient, please contact the sender by reply e-mail and destroy all copies.",
].join("\n");

const GMAIL_QUOTE = [
  "",
  "On Mon, Sep 21, 2026 at 9:02 AM Thomas Wright <thomas@wright-ai-solutions.com> wrote:",
  "> Hi Dana, quick one: we build websites for local businesses.",
  "> Don't want to hear from us again? Reply STOP and we won't email you again.",
].join("\n");

export const REPLY_DEV_R10: OutcomeCase[] = [
  // --- Asking not to be emailed ------------------------------------------
  { text: "Please remove my email from your distribution.", expected: "opt_out" },
  { text: "Kindly cease all further correspondence.", expected: "opt_out" },
  { text: "I have no interest and ask that you not contact me again.", expected: "opt_out" },
  {
    text: "Unsubscribe me from all future communications.\n\nRegards,\nDana Whitfield\nWhitfield Realty Group\n(602) 555-0142",
    expected: "opt_out",
  },
  { text: "pls take me off", expected: "opt_out" },
  { text: "Remove pls", expected: "opt_out" },
  { text: "No further emails, thank you.", expected: "opt_out" },
  { text: "Do not add me to any lists.", expected: "opt_out" },
  { text: "I did not opt in to this. Please stop.", expected: "opt_out" },
  { text: "We ask that you remove this address from your records.", expected: "opt_out" },
  { text: "Not interested. Don't write again.", expected: "opt_out" },
  { text: "UNSUB", expected: "opt_out" },
  { text: "Please refrain from emailing this office.", expected: "opt_out" },
  { text: "This is my third request: take my name off your list.", expected: "opt_out" },
  { text: "I want off this list.", expected: "opt_out" },
  { text: "Stop sending. Thanks.\n\n--\nMark Ellison | Broker\nEllison Homes", expected: "opt_out" },
  { text: "Please no more.", expected: "opt_out" },
  { text: "Mark me as do-not-contact.", expected: "opt_out" },
  { text: "I'm not the right person and I don't want these. Remove me.", expected: "opt_out" },
  { text: `Stop${GMAIL_QUOTE}`, expected: "opt_out" },
  { text: `Remove me from your list.${LEGAL_FOOTER}`, expected: "opt_out" },
  { text: "Please don't email me going forward.", expected: "opt_out" },
  { text: "Take this address off your mailing list immediately.", expected: "opt_out" },
  { text: "Désinscrivez-moi s'il vous plaît.", expected: "opt_out" },
  { text: "No me interesa, no me escriba más.", expected: "opt_out" },
  { text: "Great, thanks, but please take me off your list.", expected: "opt_out" },
  { text: "Interesting idea but please don't contact me again.", expected: "opt_out" },
  { text: "Thanks for thinking of me — however, I'd ask that you not email me again.", expected: "opt_out" },

  // --- Interested ----------------------------------------------------------
  {
    text:
      "Yes please send the pricing sheet.\n\nThis email and any files transmitted with it are confidential and intended solely for the use of the " +
      "individual to whom they are addressed. If you have received this email in error please notify the sender.",
    expected: "positive",
  },
  { text: "Interested. What's the monthly cost?\n\nBest,\nRosa\nSent from my iPhone", expected: "positive" },
  { text: "Could we set up a call Wednesday afternoon?", expected: "positive" },
  { text: "Sounds promising — can you send a sample for Pima County?", expected: "positive" },
  { text: "Yes. My direct line is 520-555-0187.", expected: "positive" },
  { text: "Happy to chat. I'm free after 4 most days.", expected: "positive" },
  { text: "Please send details to my work address, lisa@brokerage.test — don't use this one.", expected: "positive" },
  { text: "I'd like to learn more about how the data is sourced.", expected: "positive" },
  { text: "Count me in. How do I pay?", expected: "positive" },
  { text: "Can you do a trial month?", expected: "positive" },
  { text: "Stop by Thursday if you're in Tempe, I'd love to see it.", expected: "positive" },
  { text: "Definitely interested, call me after 2pm.", expected: "positive" },
  { text: "What does a year cost if I prepay?", expected: "positive" },
  // Relabelled in round 14: only says it is being passed on (see round-14 note in tests/corpus/replies.ts).
  { text: "Forwarding this to our managing broker, she'll reach out.", expected: "needs_look" },
  {
    text: "Yes!\n\nTo unsubscribe from the Desert Realty newsletter, click here. Desert Realty, 100 Main St, Mesa AZ 85201.",
    expected: "positive",
  },
  { text: "Please call me, I have questions.\n\nPlease consider the environment before printing this email.", expected: "positive" },
  { text: "Would love a demo next week.", expected: "positive" },
  { text: `How many leads per month on average?${GMAIL_QUOTE}`, expected: "positive" },
  { text: "Remove the Pima leads from the sample and resend please.", expected: "positive" },
  { text: "Don't stop — the last list was great. Can I get the next one?", expected: "positive" },
  { text: "I'd unsubscribe from my current provider in a heartbeat for this. Price?", expected: "positive" },
  { text: "Stop! Yes, this is what we've been looking for. Call me at 480-555-0111.", expected: "positive" },

  // --- Declines, complaints, unclear ---------------------------------------
  { text: "Not something we need at the moment.", expected: "needs_look" },
  { text: "We handle this in-house.", expected: "needs_look" },
  { text: "Thanks, but we'll pass for now.", expected: "needs_look" },
  { text: "I'm no longer licensed.", expected: "needs_look" },
  { text: "Please don't take this personally but we're not buying.", expected: "needs_look" },
  { text: "Not a fit for our brokerage.", expected: "needs_look" },
  { text: "Already covered by our current vendor.", expected: "needs_look" },
  { text: "This agent no longer works with our office.", expected: "needs_look" },
  { text: "Who are you and how did you get this address?", expected: "needs_look" },
  { text: "Meh.", expected: "needs_look" },
];
