// Declines, complaints and hedges for the reply classifier
// (reply-classifier.ts). None of these asks to stop, and none is a yes.
//
// - COMPLAINTS need a look: the operator may want to answer ("who is
//   this?"), redirect ("wrong person") or suppress ("this is spam").
// - HEDGE_RE ("I guess", "not sure", "maybe") makes a reply not a clear
//   answer either way, so it needs a look.
// - PLAIN_DECLINES are a plain no. On its own (nothing interested, no
//   question, no stop word, no complaint, no hedge) the reply is a
//   confident decline: the lead is closed and the address is held — never
//   suppressed, since it didn't ask to stop. Mixed with interest it needs a
//   look.

type Phrase = { re: RegExp; reason: string };

export const PLAIN_DECLINES: Phrase[] = [
  { re: /\bnot\s+(?:at\s+all\s+|really\s+)?interested\b/i, reason: "says they're not interested" },
  // "No thanks", "No, thank you.", "Thanks but no thanks", "No thank you!"
  {
    re: /\bno[\s,.!-]+(?:thanks|thank\s+you|thx|ty)\b|\bthanks,?\s+but\s+no\b|,?\s+but\s+no\b(?!\s+(?:problem|worries|rush|pressure|need\s+to|hurry|doubt|question))/i,
    reason: "says no thanks",
  },
  // A reply that opens with a bare "No." / "Nope" / "Nah" — but not "No problem" or "No worries".
  {
    re: /^\s*(?:no|nope|nah)\b(?![\s,]*(?:problem|prob|worries|worry|rush|doubt|question|matter|kidding|need\s+to|way[,!]?\s+(?:that'?s\s+)?(?:great|cool|awesome)))/i,
    reason: "says no",
  },
  // "Not for us", "This isn't for us", "Not a good fit"
  {
    re: /\b(?:not|isn'?t|is\s+not|ain'?t)\s+(?:really\s+)?(?:for\s+(?:us|me)\b|a\s+(?:good\s+|great\s+)?fit\b)/i,
    reason: "says it isn't for them",
  },
  // "We're good", "We're all set", "I'm covered" — but not "we're good to go" or "I'm good with that".
  {
    re: /\b(?:we'?re|we\s+are|i'?m|i\s+am)\s+(?:all\s+)?(?:good|set|covered|all\s+set)\b(?!\s+(?:to\s+go|with\b|for\b|on\s+(?:my|our)\s+end\s*[,-]?\s*(?:send|go)))/i,
    reason: "says they're all set",
  },
  // "No need", "We don't need this" — but not "No need to call, just email".
  {
    re: /\bno\s+need\b(?!\s+to\b)|\b(?:we|i)\s+(?:really\s+)?(?:do\s+not|don'?t|dont)\s+need\s+(?:this|that|it|your|these|those|any|a\s+(?:new\s+)?(?:website|site|service|lead|leads))\b/i,
    reason: "says they don't need it",
  },
  {
    re: /\b(?:we|i)\s+already\s+(?:have|use|work\s+with|got|pay\s+for)\b/i,
    reason: "says they already have this",
  },
  {
    re: /\b(?:i'?ll|we'?ll|i\s+will|we\s+will|hard|gonna|going\s+to)\s+pass\b(?!\s+(?:this|it|that|them|along|your|on\s+to))|^\s*pass\b[\s,]*(?:for\s+now|on\s+(?:this|that|it)|this\s+time|thanks|thank\s+you|thx)?\s*[.!]*\s*$/im,
    reason: "says they'll pass",
  },
  // "We are not the right business for this", "doesn't apply to us", "not relevant to our business"
  {
    re: /\bnot\s+(?:the|a|an)\s+(?:right|good|great|ideal|best)\s+(?:fit|match|business|company|audience|market|customer|client|time)\b|\b(?:doesn'?t|does\s+not|don'?t|do\s+not)\s+(?:apply|fit|make\s+sense)\s+(?:to|for)\s+(?:us|me|our)\b|\bnot\s+relevant\s+(?:to|for)\b/i,
    reason: "says it isn't for them",
  },
  { re: /\bnot\s+(?:currently\s+)?(?:looking\s+for|in\s+the\s+market)\b/i, reason: "says they're not looking" },
  { re: /\bretired\b/i, reason: "says they've retired" },
];

export const COMPLAINTS: Phrase[] = [
  { re: /\bwrong\s+(?:person|e-?mail|address|contact|guy|gal)\b/i, reason: "says this is the wrong person" },
  { re: /\bnot\s+(?:the|a|an)\s+(?:right|good|great|ideal|best)\s+(?:person|contact)\b/i, reason: "says this is the wrong person" },
  {
    re: /\b(?:no\s+longer|not)\s+(?:work(?:ing)?\s+(?:here|there|at)|with\s+(?:the|this)\s+(?:company|brokerage|firm))\b/i,
    reason: "says they no longer work there",
  },
  {
    re: /\b(?:how|where)(?:\s+did|'d)\s+(?:you|u)\s+(?:get|find)\s+(?:my|this|our|me|us)\b|\bwho\s+gave\s+(?:you|u)\s+(?:my|this|our)\b/i,
    reason: "asks how we got their address",
  },
  { re: /\bwho(?:\s+is|'s)\s+this\b|\bwho\s+(?:are|r)\s+(?:you|u)\b(?!\s+(?:working|recommending))/i, reason: "asks who we are" },
  // "Why do you keep emailing me?"
  {
    re: /\bwhy\s+(?:do|did|are|would|is|does)\s+(?:you|u|this|someone|your\s+company)\s+(?:keep\s+)?(?:e-?mail|contact|messag|writ|send|spam)/i,
    reason: "asks why we're emailing them",
  },
  {
    re: /\b(?:spam|spammer|spamming|unsolicited)\b(?!\s+(?:folder|filter|box|bin|tray))|\breport(?:ed|ing)?\s+(?:you|this|it)\b/i,
    reason: "calls the email spam",
  },
  { re: /\b(?:scam|scammer|scammy|fraud|phishing)\b/i, reason: "asks whether this is a scam" },
  { re: /\b(?:passed\s+away|deceased)\b/i, reason: "says the person has died" },
];

// Words that make a reply unsure rather than an answer: "Thanks, I guess",
// "maybe", "not sure yet", "we'll see". A hedged reply needs a look unless
// it also shows interest or asks a real question (REAL_QUESTION_RE), not
// just ends on a question mark.
export const HEDGE_RE = /\bi\s+(?:guess|suppose)\b|\bnot\s+(?:so\s+|too\s+)?sure\b|\bmaybe\b|\bperhaps\b|\bwe'?ll\s+see\b|\bwhatever\b/i;

/** A question that asks something ("what's included?", "can you…?"), not just a trailing "?". */
export const REAL_QUESTION_RE = /\b(?:what|what'?s|how|when|where|which|who|why|can|could|would|will|do|does|is|are|any)\b[^.!?\n]*\?/i;
