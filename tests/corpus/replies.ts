// A labelled evaluation set for the reply classifier, kept apart from the
// development cases in tests/reply-classifier.test.ts and scored by
// tests/heuristics-eval.test.ts (precision/recall with a floor that fails
// CI).
//
// Provenance: these are SYNTHETIC replies written to resemble what cold
// email to real-estate agents and small businesses gets back — they are
// not real people's mail. They were written as a batch before the scores
// were run, and a miss is recorded as a miss rather than patched away. To
// make the measurement reflect production, add anonymised real replies
// (names, addresses, phone numbers and firm names replaced) from the
// InboundReply table — see README → "Measuring the reply and address rules".
//
// First run (2026-09-25), before any rule was changed for it: precision
// 96.8%, recall 95.2%. The two missed "don't send me anything else" / "do
// not send further emails" phrasings were then added to the classifier (a
// genuine gap), so those two cases no longer measure anything new.
//
// Round 6 (2026-09-25): 61 fresh held-out cases (the "I don't want these
// emails" family, Spanish and French opt-outs, look-alikes) were written
// after the rules for those families were added from the development cases,
// and scored as-is: precision 98.3%, recall 98.3% on 102 cases. Misses:
// "Honestly I do not want any of these emails" (missed) and "Can I
// unsubscribe later if it doesn't work out?" (false opt-out).
//
// Round 7 (2026-09-26): 24 fresh held-out cases (curt and informal
// opt-outs — "knock it off", "enough with the emails", "forget my address",
// "any of these emails" — and look-alikes) written before the rules for
// that family changed. Before the change: precision 98.3%, recall 79.5% on
// 126 cases (15 missed opt-outs). After (the reviewers' own phrasings were
// added to the development set, not this one): precision 98.6%, recall
// 100.0%; the one miss left is the false opt-out "Can I unsubscribe later
// if it doesn't work out?". Caveat: the same author wrote this batch and
// the rules, so it is less independent than real mail would be.
//
// Round 9 (2026-09-26): the review found polite, rude and non-English stop
// requests ("I'd rather not receive these", "F off", "Bitte keine E-Mails
// mehr") counted as positive replies, and an interested reply asking to
// stop phone calls read as an email opt-out; those phrasings went to the
// development set. A fresh "none of the above" batch (REPLY_UNLISTED_HELD_OUT,
// 26 cases) was written before the rules changed: precision 50.0%, recall
// 11.8% before; 94.4% / 100% after (same author and session as the rules,
// so optimistic). The rule for questions about unsubscribing later, built
// from the review's example, also fixed this split's one remaining miss
// ("Can I unsubscribe later if it doesn't work out?"), so that case no
// longer measures anything new: 100% / 100% on 126 cases.
//
// optOut: true  — the sender is asking not to be contacted (CAN-SPAM opt-out).
// optOut: false — anything else, including "no thanks" and complaints that
//                 don't ask to stop (those are flagged for a look instead).

export type LabelledReply = { text: string; subject?: string; optOut: boolean };

const QUOTED_PITCH = [
  "",
  "On Tue, Sep 22, 2026 at 8:33 AM Thomas Wright <thomas@wright-ai-solutions.com> wrote:",
  "> Hi Jane, quick one: dataleadsell.com sends probate property leads for Maricopa County.",
  "> Don't want to hear from us again? Reply STOP and we won't email you again.",
].join("\n");

export const REPLY_CORPUS: LabelledReply[] = [
  // --- Opt-outs ---------------------------------------------------------
  { text: "STOP", optOut: true },
  { text: "stop" + QUOTED_PITCH, optOut: true },
  { text: "Unsubscribe", optOut: true },
  { text: "unsubscribe me please", optOut: true },
  { text: "Please unsubscribe this address.", optOut: true },
  { text: "Remove me.", optOut: true },
  { text: "remove", optOut: true },
  { text: "Please remove me from your list." + QUOTED_PITCH, optOut: true },
  { text: "Remove from list", optOut: true },
  { text: "pls remove from your mailing list thx", optOut: true },
  { text: "Take me off your list.", optOut: true },
  { text: "Take us off this list please", optOut: true },
  { text: "Please take my email off your list.", optOut: true },
  { text: "Stop emailing me.", optOut: true },
  { text: "Stop sending me these emails.", optOut: true },
  { text: "Please stop contacting me.", optOut: true },
  { text: "Stop spamming me", optOut: true },
  { text: "Quit emailing me", optOut: true },
  { text: "quit contacting our office", optOut: true },
  { text: "Cease all contact. This is a cease and desist.", optOut: true },
  { text: "Don't email me.", optOut: true },
  { text: "Do not email me again.", optOut: true },
  { text: "Do not contact me.", optOut: true },
  { text: "Don't contact us again.", optOut: true },
  { text: "Never contact me again", optOut: true },
  { text: "Please don't message me.", optOut: true },
  { text: "Please do not reach out to me again.", optOut: true },
  { text: "I'm not interested. Please don't reach out again.", optOut: true },
  { text: "Not interested, please remove me from your list.", optOut: true },
  { text: "No thanks. Stop emailing.", optOut: true },
  { text: "Delete my email address", optOut: true },
  { text: "Please delete my information from your database.", optOut: true },
  { text: "Erase my details, I never signed up for this.", optOut: true },
  { text: "Leave me alone", optOut: true },
  { text: "leave us alone please", optOut: true },
  { text: "Opt out", optOut: true },
  { text: "Please opt me out.", optOut: true },
  { text: "I'd like to opt out of these emails.", optOut: true },
  { text: "No more emails please.", optOut: true },
  { text: "I don't want any more emails from you.", optOut: true },
  { text: "We do not want your emails.", optOut: true },
  { text: "Please don't send me emails.", optOut: true },
  { text: "Don't send me anything else.", optOut: true },
  { text: "", subject: "Re: UNSUBSCRIBE", optOut: true },
  { text: "", subject: "Stop", optOut: true },
  { text: "STOP\n\nSent from my iPhone", optOut: true },
  { text: "Stop it!", optOut: true },
  { text: "I've told you before, stop emailing this address.", optOut: true },
  { text: "Kindly remove this email address from your mailing list.", optOut: true },
  { text: "Don't ever email me again.", optOut: true },
  { text: "Do not contact this address.", optOut: true },
  { text: "Please stop sending emails to this account.", optOut: true },
  { text: "Unsubscribe. Thanks.", optOut: true },
  { text: "Not interested — take me off your list", optOut: true },
  { text: "We're all set, don't contact us.", optOut: true },
  { text: "don't email me anymore", optOut: true },
  { text: "Stop messaging me or I will report you.", optOut: true },
  { text: "Remove my address from all your lists.", optOut: true },
  { text: "I am not a realtor anymore, remove me.", optOut: true },
  { text: "Please cease emailing me.", optOut: true },
  { text: "Take me off the list, thanks", optOut: true },
  { text: "Lose my email.", optOut: true },
  // Round 7, from the reviewers' reports.
  { text: "Knock it off.", optOut: true },
  { text: "Enough with the emails.", optOut: true },
  { text: "Do not send further emails.", optOut: true },
  // Moved here from the held-out split after its first run (2026-09-25),
  // where these four were missed; the rules were then fixed for them, so
  // they are development cases now.
  { text: "I would like to be removed from your mailing list.", optOut: true },
  { text: "Not interested. Remove." + QUOTED_PITCH, optOut: true },
  { text: "Please take our office off your email list.", optOut: true },
  { text: "", subject: "unsubscribe me", optOut: true },
  // Round 9, from the reviewer's report: polite, rude and non-English stop
  // requests that were counted as positive replies.
  { text: "I'd rather not receive these", optOut: true },
  { text: "I would rather not receive these.", optOut: true },
  { text: "Lose my number", optOut: true },
  { text: "F off", optOut: true },
  { text: "Bitte keine E-Mails mehr", optOut: true },

  // --- Not opt-outs -----------------------------------------------------
  { text: "Yes, interested! What does it cost?", optOut: false },
  { text: "Sounds good, send me the details." + QUOTED_PITCH, optOut: false },
  { text: "Can you call me tomorrow afternoon?", optOut: false },
  { text: "How much for Salt Lake County?", optOut: false },
  { text: "Interested. Do you cover Utah County too?", optOut: false },
  { text: "Tell me more.", optOut: false },
  { text: "Send pricing please", optOut: false },
  { text: "What's the catch?", optOut: false },
  { text: "Who is this?", optOut: false },
  { text: "Is this legit?", optOut: false },
  { text: "Sure, stop by the office on Tuesday.", optOut: false },
  { text: "Can't stop thinking about this — call me.", optOut: false },
  { text: "Please don't stop emailing me, these are useful.", optOut: false },
  { text: "Never stop sending these, they're gold.", optOut: false },
  { text: "I'm not asking to unsubscribe, just send less often.", optOut: false },
  { text: "I do not want to opt out, call me.", optOut: false },
  { text: "Don't remove me from your list, I want the updates.", optOut: false },
  { text: "Don't hesitate to email me the sample.", optOut: false },
  { text: "Busy this month — don't contact me until March, then yes.", optOut: false },
  { text: "No thanks, not interested right now.", optOut: false },
  { text: "Not interested.", optOut: false },
  { text: "Not at this time, maybe next year.", optOut: false },
  { text: "We already use a lead service.", optOut: false },
  { text: "You have the wrong person.", optOut: false },
  { text: "Wrong email, Jane left our brokerage last year.", optOut: false },
  { text: "How did you get my email?", optOut: false },
  { text: "This looks like spam.", optOut: false },
  { text: "I'm retired.", optOut: false },
  { text: "Thanks!", optOut: false },
  { text: "Received, will review.", optOut: false },
  { text: "Out of office until Monday, September 28. For urgent matters call the front desk.", optOut: false },
  { text: "I am currently out of the office with limited access to email.", optOut: false },
  { text: "Automatic reply: I'm away and will respond when I return.", optOut: false },
  { text: "Please send more info to my assistant at the office.", optOut: false },
  { text: "Can you send me a sample list?", optOut: false },
  { text: "Remind me in two weeks.", optOut: false },
  { text: "Please remove the old listing from your site and send the new pricing.", optOut: false },
  { text: "Stop by our booth at the expo, we can talk there.", optOut: false },
  { text: "Let's set up a call. When works?", optOut: false },
  { text: "Do you have a free trial?", optOut: false },
  { text: "What counties do you cover?", optOut: false },
  { text: "Yes please — sign me up.", optOut: false },
  { text: "Maybe. What's the data source?", optOut: false },
  { text: "I only work in Pinal County, sorry.", optOut: false },
  { text: "Can you email my partner instead? mike@example.test", optOut: false },
  { text: "Unsure, what makes your leads different?", optOut: false },
  { text: "I'm interested but my broker handles subscriptions.", optOut: false },
  { text: "Great timing, I was just looking for this.", optOut: false },
  { text: "Not sure yet. Send details and I'll look.", optOut: false },
  { text: "Could you remove the county filter and show me everything?", optOut: false },
  { text: "We can't stop the probate process but happy to learn more.", optOut: false },
  { text: "Hi Thomas, got your note, calling you now.", optOut: false },
  { text: "Please call instead of emailing, 480-555-0100.", optOut: false },
  { text: "Reply STOP? Ha. No, I'm interested actually.", optOut: false },
  { text: "Your unsubscribe link didn't work but I want to stay on anyway.", optOut: false },
  { text: "Do you offer a discount for teams?", optOut: false },
  { text: "Interested!" + QUOTED_PITCH, optOut: false },
  { text: "What's the monthly cost? Don't want a contract.", optOut: false },
  { text: "Too expensive for me right now.", optOut: false },
  { text: "Who else in my office did you email?", optOut: false },
  { text: "Forwarding to my team lead.", optOut: false },
  { text: "ok", optOut: false },
  { text: "Can you resend? It went to spam folder.", optOut: false },
  { text: "Please email me the brochure.", optOut: false },
  { text: "Don't email me the PDF, just the link.", optOut: false },
  { text: "Stop sign on Main St is where our office is — come by.", optOut: false },
  // Round 9, from the reviewer's report: an interested reply asking to stop
  // phone calls is not an email opt-out (it is flagged for a look).
  { text: "How much for a website? Also please stop calling my cell, email only.", optOut: false },
];

// --- Held-out split ------------------------------------------------------
// Written on 2026-09-25 after the rules above were last changed, and scored
// once as-is. First run: precision 100%, recall 80% (4 of 20 opt-outs
// missed). Because a missed opt-out means emailing someone who asked us to
// stop, those four were moved to the development split and the rules fixed
// for them; the replacement cases below the "Fresh after the first run"
// marker were written afterwards and scored once as-is. These cases are NEVER used when changing the classifier: a
// miss here is recorded, not fixed by editing the rules against this list
// (fix the rule from a development case or real traffic instead, and add
// fresh held-out cases). tests/heuristics-eval.test.ts prints this split's
// score separately.
export const REPLY_HELD_OUT: LabelledReply[] = [
  { text: "Unsubscribe me from this list.", optOut: true },
  { text: "please stop", optOut: true },
  { text: "STOP EMAILING ME", optOut: true },
  { text: "Remove me from your database please.", optOut: true },
  { text: "Do not email this address again.", optOut: true },
  { text: "Opt-out.", optOut: true },
  { text: "Stop contacting my team.", optOut: true },
  { text: "Please quit sending me these.", optOut: true },
  { text: "Don't contact me again, thanks.", optOut: true },
  { text: "Remove", subject: "Re: Probate leads for Maricopa", optOut: true },
  { text: "No more messages please.", optOut: true },
  { text: "We don't want any emails from you.", optOut: true },
  { text: "Delete our contact info.", optOut: true },
  { text: "Please never email me again.", optOut: true },
  { text: "Leave me alone or I'm reporting this.", optOut: true },
  { text: "Take us off.", optOut: true },
  { text: "Sure, what's the price for Utah County?", optOut: false },
  { text: "Let's talk Thursday at 2.", optOut: false },
  { text: "I'm not interested at this time.", optOut: false },
  { text: "Can you stop by next week to demo it?", optOut: false },
  { text: "Please don't stop — I want the free sample!", optOut: false },
  { text: "Send it to my assistant, she handles this.", optOut: false },
  { text: "Who gave you my email?", optOut: false },
  { text: "I'm with a different brokerage now.", optOut: false },
  { text: "Interested, but only for Salt Lake.", optOut: false },
  { text: "How is this different from PropStream?", optOut: false },
  { text: "Remove the watermark and I'll share it with my team.", optOut: false },
  { text: "Emailing you from my personal account — yes, interested.", optOut: false },
  { text: "Not now, try me in January.", optOut: false },
  { text: "Thanks, I'll pass this along.", optOut: false },
  { text: "Got it. What's the next step?", optOut: false },
  { text: "Please keep me posted.", optOut: false },
  { text: "No need to call, email works.", optOut: false },
  { text: "Out of the office until Oct 2.", optOut: false },
  { text: "I'm not a probate agent but my partner might be.", optOut: false },
  // Fresh after the first run (2026-09-25):
  { text: "Kindly take me off this email list.", optOut: true },
  { text: "We'd like to be removed from future emails.", optOut: true },
  { text: "Please unsubscribe us. Thank you.", optOut: true },
  { text: "Not for me. Unsubscribe.", optOut: true },
  { text: "", subject: "Remove me", optOut: true },
  { text: "Remove me from any lists you have for this address please", optOut: true },
  // Fresh batch, 2026-09-25 (round 6), written before scoring and scored
  // as-is: the "I don't want these emails" family, Spanish and French
  // opt-outs, and look-alikes that aren't opt-outs.
  { text: "I really don't want these emails.", optOut: true },
  { text: "We don't want your marketing emails, thanks.", optOut: true },
  { text: "Honestly I do not want any of these emails", optOut: true },
  { text: "I don't wish to receive further emails from your company.", optOut: true },
  { text: "Please, we no longer wish to receive these emails.", optOut: true },
  { text: "Don't want these messages. Bye.", optOut: true },
  { text: "I don’t want to receive emails like this.", optOut: true },
  { text: "we dont want ur emails", optOut: true },
  { text: "I don't want to keep getting these emails.", optOut: true },
  { text: "I never signed up for this. Stop sending me emails.", optOut: true },
  { text: "Please do not email this account in the future.", optOut: true },
  { text: "Please remove my address from your system.", optOut: true },
  { text: "Take me off whatever list this is.", optOut: true },
  { text: "Opt me out please.", optOut: true },
  { text: "unsubscribe", subject: "Re: Leads for your office", optOut: true },
  { text: "Remove", optOut: true },
  { text: "STOP.\n\nSent from my iPhone", optOut: true },
  { text: "Stop contacting my business.", optOut: true },
  { text: "Quit sending these.", optOut: true },
  { text: "Leave us alone please.", optOut: true },
  { text: "Kindly delete my contact details.", optOut: true },
  { text: "Not interested and please don't email again.", optOut: true },
  { text: "Don't ever contact me again.", optOut: true },
  { text: "No more emails please.", optOut: true },
  { text: "Por favor, no me manden más correos.", optOut: true },
  { text: "Quiero darme de baja.", optOut: true },
  { text: "No deseo recibir más correos electrónicos.", optOut: true },
  { text: "Quítenme de su lista por favor.", optOut: true },
  { text: "Bórrenme de su lista de correos.", optOut: true },
  { text: "No me escriban más.", optOut: true },
  { text: "Désabonner", optOut: true },
  { text: "Merci de me désinscrire de votre liste.", optOut: true },
  { text: "Ne me contactez plus, s'il vous plaît.", optOut: true },
  { text: "Retirez-moi de votre liste de diffusion.", optOut: true },
  { text: "Nous ne souhaitons plus recevoir vos courriels.", optOut: true },
  { text: `Unsubscribe${QUOTED_PITCH}`, optOut: true },
  { text: `I don't want these emails.${QUOTED_PITCH}`, optOut: true },
  { text: "I don't want these emails to stop — they've been useful.", optOut: false },
  { text: "I don't want emails about commercial, only residential.", optOut: false },
  { text: "Don't want to miss this — call me Monday.", optOut: false },
  { text: "I don't want to waste your time, so here's my budget: $300/month.", optOut: false },
  { text: "We don't want more agents on the account, just me.", optOut: false },
  { text: "Could you stop by our Mesa office on Friday?", optOut: false },
  { text: "Our team can't stop talking about the sample list.", optOut: false },
  { text: "Please keep the emails coming.", optOut: false },
  { text: "Remove the Pinal leads, keep Maricopa.", optOut: false },
  { text: "Can I unsubscribe later if it doesn't work out?", optOut: false },
  { text: "Send it over. If I don't like it I'll tell you.", optOut: false },
  { text: `Yes, interested — what's the cost?${QUOTED_PITCH}`, optOut: false },
  { text: `Call me at 480-555-0199.${QUOTED_PITCH}`, optOut: false },
  { text: "Not right now, maybe next quarter.", optOut: false },
  { text: "Who else in Scottsdale uses this?", optOut: false },
  { text: "Sí, me interesa. ¿Cuánto cuesta?", optOut: false },
  { text: "Oui, envoyez-moi les détails.", optOut: false },
  { text: "Llámeme el lunes por favor.", optOut: false },
  { text: "I'd rather talk by phone than email.", optOut: false },
  { text: "Please email my partner instead: she runs marketing.", optOut: false },
  { text: "Stop by any time after 3.", optOut: false },
  { text: "I don't want to commit yet, but send a sample.", optOut: false },
  { text: "Removing the old listings now — thanks for the reminder.", optOut: false },
  { text: "We have a lot of email to get through; I'll reply properly next week.", optOut: false },
  // Fresh batch, 2026-09-26 (round 7): informal and curt opt-outs, and their
  // look-alikes. Written before the rules for this family were changed
  // (the phrasings the reviewers reported went to the development set) and
  // scored before and after; see the header for the scores.
  { text: "Knock it off already.", optOut: true },
  { text: "Enough with these emails, seriously.", optOut: true },
  { text: "Enough of the emails!", optOut: true },
  { text: "Forget my address, please.", optOut: true },
  { text: "Lose this email address.", optOut: true },
  { text: "Cut it out.", optOut: true },
  { text: "Go away.", optOut: true },
  { text: "I don't want any of your emails.", optOut: true },
  { text: "We really don't want any more of these messages.", optOut: true },
  { text: "Stop with the emails.", optOut: true },
  { text: "Honestly, we don't want any of this email.", optOut: true },
  { text: "Please quit it with the emails.", optOut: true },
  { text: "no more of these please", optOut: true },
  { text: "Scrub my email from your list.", optOut: true },
  { text: "Knock on wood, this could work. Tell me more.", optOut: false },
  { text: "Enough about me — what does it cost?", optOut: false },
  { text: "I can never get enough leads, send pricing.", optOut: false },
  { text: "We never get enough of these emails, they're great.", optOut: false },
  { text: "Don't lose my email, I want the sample.", optOut: false },
  { text: "I forgot my password for your site, can you help?", optOut: false },
  { text: "Did you get my email from last week?", optOut: false },
  { text: "Go ahead and send the details.", optOut: false },
  { text: "Cut to the chase: how much?", optOut: false },
  { text: "I don't want any of the Pinal leads, only Maricopa.", optOut: false },
];

// "None of the above": opt-outs phrased in ways the rules didn't list
// (polite, rude, other languages) and look-alikes that aren't opt-outs.
// Written on 2026-09-26 before the round-9 rule change and scored as-is;
// the eval reports this as its own split. Never edit the classifier
// against these.
export const REPLY_UNLISTED_HELD_OUT: LabelledReply[] = [
  { text: "I'd prefer not to get these emails.", optOut: true },
  { text: "Please stop, not interested.", optOut: true },
  { text: "Keine Werbung, bitte.", optOut: true },
  { text: "Não me envie mais e-mails.", optOut: true },
  { text: "Non inviatemi più email.", optOut: true },
  { text: "Afmelden graag.", optOut: true },
  { text: "Get lost.", optOut: true },
  { text: "Piss off.", optOut: true },
  { text: "Screw off with this spam.", optOut: true },
  { text: "Bugger off.", optOut: true },
  { text: "I'd rather you didn't email me.", optOut: true },
  { text: "Kindly refrain from contacting me.", optOut: true },
  { text: "Please discontinue these emails.", optOut: true },
  { text: "Don't bother emailing me again.", optOut: true },
  { text: "Delete me from your system.", optOut: true },
  { text: "Stop. Not interested.", optOut: true },
  { text: "Please don't send these anymore.", optOut: true },
  { text: "Interested — but please don't call, I prefer email.", optOut: false },
  { text: "I'd rather not get on a call; can you email the details?", optOut: false },
  { text: "Can you remove the second agent from the sample list?", optOut: false },
  { text: "Yes, and please stop calling the front desk, use my cell: 602-555-0100.", optOut: false },
  { text: "Stop by Tuesday? We're interested.", optOut: false },
  { text: "How do I get this started?", optOut: false },
  { text: "We lost your number, can you call again?", optOut: false },
  { text: "Is there a way to unsubscribe from the county alerts but keep the weekly list?", optOut: false },
  { text: "Fantastic, sign us up.", optOut: false },
];
