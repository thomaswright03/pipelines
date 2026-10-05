// Round-11 batch for the reply classifier, scored on the outcomes the app
// acts on (tests/heuristics-eval.test.ts).
//
// Round 14 (2026-10-05): RE-FILED AS DEVELOPMENT DATA. Every case below has
// been printed, miss by miss, on every CI run since it was written, and read
// while later rules were changed, so it no longer measures anything unseen.
// It is scored as a development batch ("synthetic dev, round 11 batch"); the only held-out set is
// tests/corpus/held-out/replies.ts (real, exported replies, frozen).
//
// Provenance: SYNTHETIC. Written on 2026-09-26 as one batch, BEFORE the
// round-11 rules for courtesy replies and plain declines existed, to
// resemble the mix a cold-email inbox actually gets back: many short
// "Thanks" / "Got it" notes and plain no-thank-yous alongside opt-outs and
// interested replies, with greetings, sign-offs, signatures, emoji and
// quoted history. The same author then wrote the new rules, so this batch
// is less independent than real mail; it is scored as-is and never edited.
//
// `expected` is what a careful operator would want the app to do:
//   opt_out      — asks not to be emailed/contacted
//   positive     — interested: a yes, a question, a request
//   declined     — a plain no (not interested, no thanks, all set) that
//                  neither asks to stop nor asks anything
//   acknowledged — only a courtesy note (thanks, got it, received)
//   needs_look   — anything else: complaints, wrong person, mixed, unclear
//
// Scores (90 cases: 16 opt_out, 18 positive, 20 declined, 19 acknowledged,
// 17 needs_look), recorded once on 2026-09-26:
// - Round-10 rules (three verdicts): 1 unsafe ("Thanks, I guess?" counted
//   as a positive reply), 50 of 90 (56%) need a look.
// - Round-11 rules: 0 unsafe, 17 of 90 (19%) need a look, every case read
//   as labelled. Caveat: the first run of the round-11 rules also counted
//   "Thanks, I guess?" as positive; the hedge rule (reply-rules/decline.ts,
//   HEDGE_RE) was then written with that case in view, so this batch no
//   longer measures that rule independently.

import type { ReplyOutcome } from "./real-replies";

export type OutcomeCase = { text: string; subject?: string; expected: ReplyOutcome };

const OUTLOOK_QUOTE = [
  "",
  "________________________________",
  "From: Thomas Wright <thomas@wright-ai-solutions.com>",
  "Sent: Tuesday, September 22, 2026 8:40 AM",
  "To: Owner",
  "Subject: Quick question",
  "",
  "Hi, we build websites for local businesses.",
].join("\n");

const APPLE_QUOTE = [
  "",
  "On Sep 22, 2026, at 8:40 AM, Thomas Wright <thomas@wright-ai-solutions.com> wrote:",
  "> Hi, dataleadsell.com sends probate leads for your county.",
  "> Don't want to hear from us again? Reply STOP and we won't email you again.",
].join("\n");

export const REPLY_DEV_R11: OutcomeCase[] = [
  // --- Courtesy notes ----------------------------------------------------
  { text: "Thanks!", expected: "acknowledged" },
  { text: "Thank you.", expected: "acknowledged" },
  { text: "Got it, thanks.", expected: "acknowledged" },
  { text: "Received, thank you", expected: "acknowledged" },
  { text: "Thanks for reaching out.", expected: "acknowledged" },
  { text: "thx", expected: "acknowledged" },
  { text: `Thank you!${APPLE_QUOTE}`, expected: "acknowledged" },
  { text: "Thanks,\nMaria", expected: "acknowledged" },
  { text: "Hi Thomas, thanks for the email.", expected: "acknowledged" },
  { text: "Noted, thanks.", expected: "acknowledged" },
  { text: "Ok thank you", expected: "acknowledged" },
  { text: "Thank you 🙏", expected: "acknowledged" },
  { text: `Thanks for the info.${OUTLOOK_QUOTE}`, expected: "acknowledged" },
  { text: "Much appreciated.", expected: "acknowledged" },
  { text: "Thanks so much!\n\nSent from my iPhone", expected: "acknowledged" },
  { text: "Received.", expected: "acknowledged" },
  { text: "Thank you for sending this over.", expected: "acknowledged" },
  { text: "Got it.", expected: "acknowledged" },
  { text: "k", expected: "acknowledged" },

  // --- Plain declines ------------------------------------------------------
  { text: "Not interested, thanks.", expected: "declined" },
  { text: "No thank you.", expected: "declined" },
  { text: "We're all set, thank you.", expected: "declined" },
  { text: "No thanks, we already have a website.", expected: "declined" },
  { text: "Not interested at this time.", expected: "declined" },
  { text: "Nope.", expected: "declined" },
  { text: "I'll pass, thanks.", expected: "declined" },
  { text: "We already use a lead service we like.", expected: "declined" },
  { text: "Thanks, but not interested.", expected: "declined" },
  { text: "No need, but thanks.", expected: "declined" },
  { text: `Not interested.${APPLE_QUOTE}`, expected: "declined" },
  { text: "Appreciate it but we're good.", expected: "declined" },
  { text: "Not for us.", expected: "declined" },
  { text: "Thanks but no thanks.\n\nBest,\nKevin", expected: "declined" },
  { text: "We don't need this service.", expected: "declined" },
  { text: "I'm retired now.", expected: "declined" },
  { text: "Not looking for anything like this right now.", expected: "declined" },
  { text: "No, thanks. We're covered.", expected: "declined" },
  { text: "Hi, not interested. Have a good day.", expected: "declined" },
  { text: "Pass.", expected: "declined" },

  // --- Asking not to be emailed ------------------------------------------
  { text: "Please take me off your list, thanks.", expected: "opt_out" },
  { text: "STOP", expected: "opt_out" },
  { text: "Unsubscribe", expected: "opt_out" },
  { text: "Thanks, but please remove me.", expected: "opt_out" },
  { text: "Don't email me again.", expected: "opt_out" },
  { text: "Remove this email from your list.", expected: "opt_out" },
  { text: "Not interested. Stop emailing me.", expected: "opt_out" },
  { text: `stop${OUTLOOK_QUOTE}`, expected: "opt_out" },
  { text: "Please stop sending me these.", expected: "opt_out" },
  { text: "No more emails please.", expected: "opt_out" },
  { text: "Opt me out.", expected: "opt_out" },
  { text: "Thank you, but I'd like to be removed from your mailing list.", expected: "opt_out" },
  { text: "Please unsubscribe me.\n\nThanks,\nLinda", expected: "opt_out" },
  { text: "I don't want these emails. Remove me.", expected: "opt_out" },
  { text: "Take us off your list.", expected: "opt_out" },
  { text: "Quit emailing us.", expected: "opt_out" },

  // --- Interested ----------------------------------------------------------
  { text: "Yes, send me more info.", expected: "positive" },
  { text: "Thanks! How much is it per month?", expected: "positive" },
  { text: "Interested. Call me at 602-555-0133.", expected: "positive" },
  { text: "Sure, let's talk Thursday.", expected: "positive" },
  { text: "Thanks for reaching out — what would a site like that cost?", expected: "positive" },
  { text: "Can you send a sample list for Salt Lake County?", expected: "positive" },
  { text: "Yes please.", expected: "positive" },
  { text: "Got it, thanks. Can we talk next week?", expected: "positive" },
  { text: "Tell me more.", expected: "positive" },
  { text: "Sounds good, send it over.", expected: "positive" },
  { text: "I'd like to see an example.", expected: "positive" },
  { text: "Thank you — yes, I'm interested.", expected: "positive" },
  { text: "What areas do you cover?", expected: "positive" },
  { text: `Please call me tomorrow morning.${OUTLOOK_QUOTE}`, expected: "positive" },
  // Relabelled in round 14: only says it will be read (see round-14 note in tests/corpus/replies.ts).
  { text: "Received, will take a look and get back to you.", expected: "needs_look" },
  { text: "Ok, send me the details.", expected: "positive" },
  { text: "Absolutely, I've been meaning to redo our website.", expected: "positive" },
  // Relabelled in round 14: only says it is being passed on.
  { text: "Thanks! Forwarding to my business partner.", expected: "needs_look" },

  // --- Needs a look ----------------------------------------------------------
  { text: "Who is this?", expected: "needs_look" },
  { text: "How did you get my email?", expected: "needs_look" },
  { text: "This is spam.", expected: "needs_look" },
  { text: "Wrong person, sorry.", expected: "needs_look" },
  { text: "She no longer works here.", expected: "needs_look" },
  { text: "Maybe.", expected: "needs_look" },
  { text: "Hmm, not sure.", expected: "needs_look" },
  { text: "Gracias.", expected: "needs_look" },
  { text: "Thanks, I guess?", expected: "needs_look" },
  { text: "Why do you keep emailing me?", expected: "needs_look" },
  { text: "Thanks. Don't call my cell though.", expected: "needs_look" },
  { text: "We'll see.", expected: "needs_look" },
  { text: "Thanks, the owner passed away last year.", expected: "needs_look" },
  { text: "Is this a scam?", expected: "needs_look" },
  { text: "Thanks but I'm not the owner.", expected: "needs_look" },
  { text: "Not now, but maybe in the spring.", expected: "needs_look" },
  { text: "Thanks — not sure yet, let me think about it.", expected: "needs_look" },
];
