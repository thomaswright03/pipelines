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
// folder but I'm interested.". Round 6 (2026-09-25): 35 fresh cases
// scored as-is — 50 cases, precision 96.0%, recall 85.7%; new misses "No,
// thank you.", "Who gave you this email address?" and "This isn't for us.".

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
  // Fresh batch, 2026-09-25 (round 6), written before scoring and scored as-is.
  { text: "We're not interested, thanks anyway.", review: true },
  { text: "No thanks.", review: true },
  { text: "no thx", review: true },
  { text: "You've got the wrong guy, I sell insurance.", review: true },
  { text: "Wrong address — this is a shared inbox for the whole office.", review: true },
  { text: "Tom retired last spring.", review: true },
  { text: "I no longer work at Desert Sun Realty.", review: true },
  { text: "How did you get my contact info?", review: true },
  { text: "Pretty sure this is spam.", review: true },
  { text: "Not really interested, we generate our own leads.", review: true },
  { text: "The owner is deceased. Please update your records.", review: true },
  { text: "I've reported this as spam.", review: true },
  { text: "Not interested in probate at all.", review: true },
  { text: "We're not with this brokerage any longer, sorry.", review: true },
  { text: "No, thank you.", review: true },
  { text: "Hola, no gracias.", review: true },
  { text: "Non merci, ça ne nous intéresse pas.", review: true },
  { text: "Gracias pero no estoy interesado.", review: true },
  { text: "Who gave you this email address?", review: true },
  { text: "This isn't for us.", review: true },
  { text: "Yes — call me this afternoon.", review: false },
  { text: "Send the sample for Pima County.", review: false },
  { text: "How much is it per month?", review: false },
  { text: "I'm interested but only for Tucson.", review: false },
  { text: "Can we meet next week?", review: false },
  { text: "Great timing, we were just looking for this.", review: false },
  { text: "Forwarding to our broker, she decides.", review: false },
  { text: "What's the difference between the two plans?", review: false },
  { text: "Sounds good. Send the contract.", review: false },
  { text: "Do you have references in Mesa?", review: false },
  { text: "Please call my cell instead: 602-555-0144.", review: false },
  { text: "I'll look this over this weekend.", review: false },
  { text: "Maybe — what's the minimum term?", review: false },
  { text: "Thanks! Talk soon.", review: false },
  { text: "Can you include the property addresses?", review: false },
];
