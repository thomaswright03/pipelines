// Example phrasings for each rule group of the reply classifier, asserted
// by tests/reply-classifier.test.ts: `verdict` is what classifyReply must
// return for each. Add an example here whenever a group changes.
import type { ReplyVerdict } from "@/lib/outreach/reply-classifier";

export const RULE_EXAMPLES: { group: string; verdict: ReplyVerdict; examples: string[] }[] = [
  {
    group: "0. footers and signatures are not read",
    verdict: "positive",
    examples: [
      "Interested! Can you call me Thursday?\n\nThis email and any attachments are confidential. If you received this in error, please notify the sender and delete it. To unsubscribe from our newsletter click here.",
      "Yes, send it over.\n\nBest,\nJane Doe\nDesert Realty | Unsubscribe from our listings alerts",
      "Sounds good.\n\nDon't want to hear from us again? Reply STOP and we won't email you again.",
      "Sounds good, show me Tuesday.\n\nNot interested? Just reply “unsubscribe” and I’ll take you off.",
    ],
  },
  {
    group: "1. a stop request alone is an opt-out",
    verdict: "opt_out",
    examples: [
      "STOP",
      "unsubscribe",
      "Remove me.",
      "Please stop emailing me. I am not interested in this at all.",
      "Take me off your list.",
      "Thanks, but please remove me.",
      "Please do not send any further correspondence.",
      "No further correspondence please.",
      "Please cease all correspondence.",
      "Not interested. No further contact.",
    ],
  },
  {
    group: "1. a yes that only opens a stop request is an opt-out",
    verdict: "opt_out",
    examples: ["Yes, unsubscribe me", "Sure, remove me from your list", "OK. Remove me."],
  },
  {
    group: "1. a stop request with interest needs a look",
    verdict: "needs_look",
    examples: [
      "Sure — but don't email me at this address, use jane@other.test instead.",
      "Please unsubscribe my old address and use this one going forward — send the pricing here.",
      "Stop! This is exactly what I need. Call me.",
      "Take me off the waitlist at my current vendor, I'd rather go with you. What's the price?",
      "How much for a website? Also please stop calling my cell, email only.",
    ],
  },
  {
    group: "2. stop words keep a reply from counting as positive",
    verdict: "needs_look",
    examples: [
      "I'd appreciate it if you didn't email me again.",
      "Kindly exclude me from future mailings.",
      "I do not wish to be contacted.",
      "Put me on your do not contact list",
      "Take this address off whatever list you bought.",
      "cancel my subscription to these emails",
      "Kindly desist from sending further emails.",
      "Pls rmv",
      "Kindly refrain from any further outreach of that kind.",
    ],
  },
  {
    group: "3. complaints need a look",
    verdict: "needs_look",
    examples: [
      "You have the wrong person.",
      "How did you get my email?",
      "Who is this?",
      "This is spam.",
      "Not interested — is this a scam?",
    ],
  },
  {
    group: "4. a reply that puts it off needs a look, however warmly it says so",
    verdict: "needs_look",
    examples: [
      "Sounds great but not right now, maybe next quarter",
      "Perfect timing actually but our budget is frozen till 2027",
      "Check back in a few months.",
      "Remind me in two weeks.",
    ],
  },
  {
    group: "4. a hedged reply needs a look",
    verdict: "needs_look",
    examples: ["Maybe.", "Thanks, I guess.", "Not sure yet.", "Not interested right now, maybe next year.", "Yes, maybe."],
  },
  {
    group: "4. a hedge with a real question or a request is interested",
    verdict: "positive",
    examples: ["Maybe — what's the minimum term?", "I guess so. Send me the pricing for Mesa."],
  },
  {
    group: "5. another language needs a look",
    verdict: "needs_look",
    examples: ["Gracias, me interesa. Llámeme mañana.", "Nein danke.", "Merci."],
  },
  {
    group: "6. a plain no on its own is a decline",
    verdict: "declined",
    examples: [
      "Not interested.",
      "No thanks.",
      "We're all set, thank you.",
      "We already have a website.",
      "Thanks but no thanks.\n\nBest,\nKevin",
      "I'll pass.",
    ],
  },
  {
    group: "6. a no that also sounds interested needs a look",
    verdict: "needs_look",
    examples: ["No thanks — but what does the premium plan cost?", "Not interested right now, call me in March."],
  },
  {
    group: "7. a courtesy note on its own is acknowledged",
    verdict: "acknowledged",
    examples: ["Thanks!", "Got it, thank you.", "Received.", "OK", "Thanks,\nMaria", "Hi Thomas, thanks for the email.", "Thank you 🙏"],
  },
  {
    group: "8. interest counts as positive",
    verdict: "positive",
    examples: [
      "Yes, interested — what does it cost?",
      "Tell me more.",
      "Call me at 480-555-0199.",
      "Sure, stop by the office Tuesday.",
      "👍",
      "Thanks! What does it cost?",
      "Got it. What's the next step?",
    ],
  },
  {
    group: "9. only passing it on or thinking it over needs a look",
    verdict: "needs_look",
    examples: ["Thank you, I will pass this on to the owner.", "I will think about it", "Thanks! Forwarding to my business partner."],
  },
  {
    group: "10. nothing recognised needs a look",
    verdict: "needs_look",
    examples: ["We'll stick with what we have.", "Hmm.", "Please don't take this personally.", "Thanks\nNo"],
  },
];
