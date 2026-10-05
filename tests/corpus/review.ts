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
// Round 9 (2026-09-26): the review found that any reply the rules couldn't
// place counted as positive. The metric is now "not counted as a positive
// reply" (flagged for a look, or an opt-out), and a positive reply needs a
// positive signal. A fresh "none of the above" batch (REVIEW_UNLISTED_HELD_OUT,
// 44 cases) was written before the change: precision 100%, recall 8.3%
// before; 100% / 100% after. That batch was written by the same author in
// the same session as the new rules, so treat its "after" score as
// optimistic. On this split: the "spam folder" false flag was fixed by the
// same change (a spam *folder* is no complaint), and "No rush, whenever you
// can." is now flagged (no positive signal) — 97.8% / 100% on 78 cases.

// Round 14 (2026-10-05): both former held-out lists are now scored as
// development batches (REVIEW_DEV_ROUNDS_5_7, REVIEW_DEV_ROUND_9): they
// have been printed miss by miss on every CI run. Replies that only say the
// email is being passed on or will be read ("Forwarding to our broker, she
// decides.", "I'll look this over this weekend.") are relabelled
// `review: true`: the round-14 review found such replies counted as
// interested, and the rules now send them to a look (see the round-14 note
// in replies.ts).

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
  { text: "Received, will review.", review: true }, // relabelled in round 14
  // Round 8, from the reviewer's report: one-word answers were read as
  // "written in another language" ("y" is a Spanish stop word).
  { text: "Y", review: false },
  { text: "y", review: false },
  { text: "Si", review: false },
  { text: "Oui", review: false },
  // Round 9, from the reviewer's report: declines that match no listed
  // phrase were counted as positive replies, and an interested reply that
  // asks to stop phone calls was read as an opt-out. From round 9 a reply
  // counts as positive only on a positive signal; these are the cases the
  // rules were built from.
  { text: "Pass.", review: true },
  { text: "We are not the right business for this", review: true },
  { text: "How much for a website? Also please stop calling my cell, email only.", review: true },
  { text: "Nein danke.", review: true },
  { text: "Yes, interested — what does it cost?", review: false },
];

export const REVIEW_DEV_ROUNDS_5_7: LabelledReview[] = [
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
  { text: "Forwarding to our broker, she decides.", review: true }, // relabelled in round 14
  { text: "What's the difference between the two plans?", review: false },
  { text: "Sounds good. Send the contract.", review: false },
  { text: "Do you have references in Mesa?", review: false },
  { text: "Please call my cell instead: 602-555-0144.", review: false },
  { text: "I'll look this over this weekend.", review: true }, // relabelled in round 14
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
  { text: "I'll pass this along to my broker.", review: true }, // relabelled in round 14
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

// "None of the above": real-looking declines, brush-offs and unclear
// replies that match no listed phrase, and ordinary positive replies — the
// class the round-9 review found was silently counted as positive (before
// round 9 anything the rules couldn't place counted as a yes). Written on
// 2026-09-26 before the round-9 rule change and scored as-is; kept apart
// so the eval reports it as its own split. Same held-out rules as above:
// never edit the classifier against these.
export const REVIEW_DEV_ROUND_9: LabelledReview[] = [
  { text: "We'll stick with what we have.", review: true },
  { text: "Not at this time.", review: true },
  { text: "Maybe next year.", review: true },
  { text: "Our budget is spent for the year.", review: true },
  { text: "We handle all of that in-house.", review: true },
  { text: "I'm happy with our current provider.", review: true },
  { text: "Doesn't apply to us.", review: true },
  { text: "Not relevant to our business.", review: true },
  { text: "Can't justify the cost for a two-person shop.", review: true },
  { text: "I think I'll skip this one.", review: true },
  { text: "Thanks for reaching out.", review: true },
  { text: "Hmm.", review: true },
  { text: "We're closing the business at the end of the year.", review: true },
  { text: "I don't do probate.", review: true },
  { text: "We only work with referrals.", review: true },
  { text: "Already got someone for that.", review: true },
  { text: "Please don't bother.", review: true },
  { text: "Why do you keep emailing me?", review: true },
  { text: "Grazie, non siamo interessati.", review: true },
  { text: "Obrigado, mas não temos interesse.", review: true },
  { text: "Geen interesse, dank je.", review: true },
  { text: "Wir haben kein Interesse.", review: true },
  { text: "Спасибо, не интересно.", review: true },
  { text: "不需要，谢谢。", review: true },
  { text: "Yes please, send me the details.", review: false },
  { text: "Interested. What's the price?", review: false },
  { text: "Could you give me a call tomorrow?", review: false },
  { text: "Sure, let's talk.", review: false },
  { text: "Sounds great, what are the next steps?", review: false },
  { text: "I'd like to see a sample.", review: false },
  { text: "What would it cost for a five-page site?", review: false },
  { text: "Please send more info.", review: false },
  { text: "Count me in.", review: false },
  { text: "Let's do it.", review: false },
  { text: "Ok, send it over.", review: false },
  { text: "Tell me more about the Maricopa list.", review: false },
  { text: "I'm in. How do I pay?", review: false },
  { text: "My partner handles this, cc'ing her here.", review: true }, // relabelled in round 14
  { text: "Call me at 480-555-0199.", review: false },
  { text: "Absolutely, when can we start?", review: false },
  { text: "This could be useful for us. What's involved?", review: false },
  { text: "Happy to chat next week.", review: false },
  { text: "Good timing — we've been meaning to redo our site.", review: false },
  { text: "Book me in for Tuesday.", review: false },
];
