// A labelled set for the "needs a look" flag of the reply classifier
// (src/lib/outreach/reply-classifier.ts, REVIEW_PHRASES): a reply that isn't
// an opt-out but reads like a brush-off or a complaint ("not interested",
// "wrong person", "how did you get my email") is flagged for a human look
// instead of moving the lead to Responded. Scored by
// tests/heuristics-eval.test.ts.
//
// Provenance: SYNTHETIC replies, not real mail; opt-outs are left out (they
// are scored in replies.ts). `review: true` means an operator should look
// before the lead counts as a positive reply.
//
// Splits: REVIEW_DEV was written alongside the rules; REVIEW_HELD_OUT was
// written separately, scored once as-is, and is never used when changing
// the rules. First run (2026-09-25): precision 87.5%, recall 87.5% — missed
// "Where did you get this address?", flagged "Your email went to my spam
// folder but I'm interested.".

export type LabelledReview = { text: string; review: boolean };

export const REVIEW_DEV: LabelledReview[] = [
  { text: "Not interested.", review: true },
  { text: "No thanks.", review: true },
  { text: "You have the wrong person.", review: true },
  { text: "Wrong email, Jane left our brokerage last year.", review: true },
  { text: "I no longer work here.", review: true },
  { text: "How did you get my email?", review: true },
  { text: "This looks like spam.", review: true },
  { text: "I'm retired.", review: true },
  { text: "Not really interested, sorry.", review: true },
  { text: "Yes, interested! What does it cost?", review: false },
  { text: "Tell me more.", review: false },
  { text: "Can you call me tomorrow afternoon?", review: false },
  { text: "Who is this?", review: false },
  { text: "Send pricing please", review: false },
  { text: "Received, will review.", review: false },
];

export const REVIEW_HELD_OUT: LabelledReview[] = [
  { text: "Not interested at this time.", review: true },
  { text: "No thank you, we're covered.", review: true },
  { text: "Wrong contact — try our office manager.", review: true },
  { text: "She is not with the company anymore.", review: true },
  { text: "Where did you get this address?", review: true },
  { text: "This is unsolicited. Reporting you.", review: true },
  { text: "Dave passed away in June.", review: true },
  { text: "I'm not working at that brokerage anymore.", review: true },
  { text: "Interested, send details.", review: false },
  { text: "What counties do you cover?", review: false },
  { text: "Let's set up a call Thursday.", review: false },
  { text: "Is there a free trial?", review: false },
  { text: "Sure, sounds interesting.", review: false },
  { text: "Can you send it to my assistant?", review: false },
  { text: "Your email went to my spam folder but I'm interested.", review: false },
];
