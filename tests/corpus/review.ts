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
// Round 7 (2026-09-26): 28 fresh cases (polite declines, "we're all set",
// "no need", "who is this", "I'll pass" and look-alikes such as "No
// problem" or "I'll pass this along") written before the rules changed.
// Before: 78 cases, precision 96.3%, recall 59.1%. After the new rules
// (built from the reviewers' phrasings, added to REVIEW_DEV): precision
// 97.7%, recall 95.5% — the misses "Where'd you get my email?" and "Who's
// this?" exposed a contraction bug, which was then fixed (97.8% / 100%), so
// those two no longer measure anything new. "Who is this?" in REVIEW_DEV
// was relabelled to needs-a-look in the same round. Same-author caveat as
// in replies.ts.

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
  // Relabelled in round 7: "who is this" is no sign of interest, and a
  // false flag only asks for a glance.
  { text: "Who is this?", review: true },
  // Round 7, from the reviewers' reports: brush-offs that were counted as
  // positive replies.
  { text: "Not for us, thanks", review: true },
  { text: "We're good, no need.", review: true },
  { text: "We don't need a website.", review: true },
  { text: "No, thanks.", review: true },
  { text: "No problem, send it over.", review: false },
  { text: "We're good to go, send the link.", review: false },
  { text: "Send pricing please", review: false },
  { text: "Received, will review.", review: false },
  // Round 8, from the reviewer's report: one-word answers were read as
  // "written in another language" ("y" is a Spanish stop word).
  { text: "Y", review: false },
  { text: "y", review: false },
  { text: "Si", review: false },
  { text: "Oui", review: false },
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
  // Fresh batch, 2026-09-26 (round 7): polite declines, "we're all set",
  // "who is this" and their look-alikes. Written before the rules for these
  // families were changed (the phrasings the reviewers reported went to the
  // development set); see the header for the scores.
  { text: "Thanks, but we're all set.", review: true },
  { text: "Not for me, thanks.", review: true },
  { text: "We don't need this.", review: true },
  { text: "No thank you!", review: true },
  { text: "Nope.", review: true },
  { text: "Nah, we're good.", review: true },
  { text: "Who are you?", review: true },
  { text: "Where'd you get my email?", review: true },
  { text: "We already have a web guy.", review: true },
  { text: "I'll pass.", review: true },
  { text: "Not a good fit for us.", review: true },
  { text: "No need, thanks.", review: true },
  { text: "Who's this?", review: true },
  { text: "We already work with another lead provider.", review: true },
  { text: "Thanks but no thanks.", review: true },
  { text: "Not looking for anything like this.", review: true },
  { text: "No problem, call me at 3.", review: false },
  { text: "We're good to go — send the invoice.", review: false },
  { text: "I'll pass this along to my broker.", review: false },
  { text: "No worries, Thursday works.", review: false },
  { text: "I'm good with that price.", review: false },
  { text: "Who do I pay?", review: false },
  { text: "Where do I sign up?", review: false },
  { text: "Not sure yet — what's included?", review: false },
  { text: "We don't need a contract, right? Month to month?", review: false },
  { text: "Now's a good time, call me.", review: false },
  { text: "We already talked last week, send the sample.", review: false },
  { text: "No rush, whenever you can.", review: false },
];
