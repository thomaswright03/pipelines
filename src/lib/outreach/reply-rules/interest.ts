// Signs of interest (reply-classifier.ts): a reply needs one of these, a
// question, or a number or address to use, to count as positive.

// Signs of interest. A reply needs one of these (or a question) to count as positive.
export const INTEREST_SIGNALS: RegExp[] = [
  // A yes: "Yes", "Sure", "OK", "Absolutely", "Sí", "Oui" opening a line, or "yes"/"yeah" anywhere.
  // Not when a negation follows: "Please do not send…", "Sure, not now".
  /^[\s"'(¡¿]*(?:y|ya|yes+|yeah|yep|yup|yea|sure|ok(?:ay)?|k|absolutely|definitely|certainly|of\s+course|please\s+do|go\s+ahead|deal|s[ií]|oui|ja|claro|d'accord)(?![\p{L}\p{N}])(?![\s,.!-]*(?:not|never)\b)/imu,
  /\b(?:yes|yeah|yep|yup|absolutely|definitely)\b/i,
  // Interest in any of the languages we get replies in ("interested", "me interesa", "intéressé", "interessiert").
  /\bint[eé]r[eé]s(?:ted|ting|a|ado|ada|s[eé]e?|s[eé]es?|siert|sato|sati)(?![\p{L}\p{N}])/iu,
  // Asking for something: details, a sample, a call, pricing.
  /\b(?:send|e-?mail|forward|share|shoot)\s+(?:me|us|my|our|it|them|over|the|a|an|some|more|your|pricing|prices|details|info)\b/i,
  // Asking to be followed up with: "remind me in two weeks", "try me in January".
  /\bremind\s+(?:me|us)\b|\btry\s+(?:me|us)\s+(?:again|in|next|after)\b|\b(?:follow\s+up|check\s+back|circle\s+back)\s+(?:with\s+(?:me|us)\s+)?(?:in|next|after)\b/i,
  /\b(?:call|ring|phone|text)\s+(?:me|us|my|our|at|on|back|any\s*time|tomorrow|today|this|next|(?:mon|tues|wednes|thurs|fri|satur|sun)day)\b/i,
  /\btell\s+(?:me|us)\s+more\b|\b(?:more|some|the)\s+(?:info|information|details)\b|\blearn\s+more\b|\bnext\s+steps?\b/i,
  /\b(?:pricing|prices|rates|a\s+quote|sample)\s+(?:please|pls|plz)\b/i,
  // Agreement and enthusiasm.
  /\bsounds\s+(?:good|great|interesting|fine|promising|perfect|like\s+a\s+plan)\b|\b(?:great|perfect|good)\s+timing\b|\b(?:great|perfect|awesome|excellent|fantastic|wonderful|brilliant|useful|helpful|valuable|gold)\b|\blove\s+(?:it|this|that|to)\b|[👍✅🙌👌]/iu,
  /\blet'?s\b|\bcount\s+(?:me|us)\s+in\b|\b(?:i'?m|we'?re|i\s+am|we\s+are)\s+in\b(?!\s+(?:the|a|an|no|our|my|this)\b)|\bhappy\s+to\b|\b(?:i'?d|we'?d|i\s+would|we\s+would)\s+(?:like|love)\b/i,
  /\bworks\s+for\s+(?:me|us)\b|\b(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day|tomorrow|today|that|this|it|e-?mail|phone|text|either)\s+works\b|\bsee\s+you\b|\b(?:stop|come|drop|swing)\s+by\b|\b(?:we|i)\s+can\s+(?:talk|chat|meet|discuss)\b|\b(?:good|fine|ok|okay|happy)\s+with\s+(?:that|the|this|it)\b|\bkeep\s+me\s+posted\b|\bkeep\s+(?:the|them|these)\s+(?:e-?mails\s+)?coming\b|\btalk\s+soon\b/i,
  // Meeting, trying or buying it.
  /\b(?:meet(?:ing)?\s+(?:up|next|this|on|at|with|tomorrow|today|in)|schedule\s+(?:a|an|the|some)|set\s+up\s+(?:a|an|the|some|time)|book\s+(?:me|us|a|an|in|time)|(?:a|the)\s+demo|free\s+trial|appointment|(?:to|a)\s+chat|chat\s+(?:next|this|tomorrow|today|on|at|soon)|talk\s+(?:next|this|tomorrow|today|on|at|soon|by\s+phone|more|then|later)|get\s+(?:this\s+|it\s+)?started|sign\s+(?:me\s+|us\s+)?up|subscribe)\b/i,
  // Will read it, or passing it to whoever decides.
  /\b(?:look(?:ing)?\s+(?:it|this|that|them)\s+over|(?:will|i'?ll|we'?ll)\s+(?:review|look|check|read|consider|think|get\s+back|reply|respond|follow\s+up)|take\s+a\s+look)\b|\b(?:forward(?:ing|ed)?|pass(?:ing)?\s+(?:this|it)\s+(?:along|on)|cc'?(?:ing|'?d|ed)|looping\s+in)\b/i,
  /\bgot\s+(?:it|your\s+(?:note|e-?mail|message))\b|\bcalling\s+you\b|\bi'?ll\s+call\b/i,
  // Wanting it: "I want to see a sample", "we need a new site".
  /\b(?:i|we)\s+(?:want|need)\s+(?:to\s+(?:see|try|know|learn|hear|talk|get|start|sign|buy|order)|(?:a|an|the|some|more|this|that|it|one|pricing|details))\b/i,
];
// A number to reach them on, or an address to use instead, is a sign of interest too.
export const CONTACT_DETAIL_RE = /\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
// Asking something counts too ("What does it cost?", "Do you cover Mesa?").
export const QUESTION_RE = /\?|^\s*(?:what|how|when|where|which|do|does|can|could|would|will|is|are)\b[^.!\n]*$/im;

// A positive signal right after one of these, in the same clause, is negated ("not that interested").
export const NEGATION_WORD_RE =
  /\b(?:not|no|never|don'?t|dont|doesn'?t|didn'?t|did\s+not|isn'?t|aren'?t|won'?t|wouldn'?t|can'?t|cannot|nor|neither|without|hardly)\b/i;

// "Don't hesitate to email me the sample" and "don't forget to call me" aren't negations.
export const NOT_A_NEGATION_RE = /\b(?:don'?t|dont|do\s+not|never)\s+(?:hesitate|forget|miss|wait)\b/gi;
