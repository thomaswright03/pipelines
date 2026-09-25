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
  { text: "Do not send further emails.", optOut: true },
  // Moved here from the held-out split after its first run (2026-09-25),
  // where these four were missed; the rules were then fixed for them, so
  // they are development cases now.
  { text: "I would like to be removed from your mailing list.", optOut: true },
  { text: "Not interested. Remove." + QUOTED_PITCH, optOut: true },
  { text: "Please take our office off your email list.", optOut: true },
  { text: "", subject: "unsubscribe me", optOut: true },

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
];
