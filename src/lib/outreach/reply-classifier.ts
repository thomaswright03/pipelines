// Reads an inbound reply and decides what the app may do with it by itself.
//
// Only a CONFIDENT reading acts automatically. Every reply gets one of:
//
//   opt_out    — the reply asks not to be emailed, and nothing in it pulls
//                the other way. The address is suppressed at once (CAN-SPAM).
//   positive   — the reply shows interest (a yes, a question, a request)
//                and nothing in it could be asking us to stop or saying no.
//                It counts as a reply and moves the lead to Responded.
//   needs_look — anything else. The lead is flagged "Reply needs a look",
//                it doesn't count as a reply or as an opt-out, and no email
//                goes to the address until the operator resolves it (see
//                inbound.ts and send.ts). The operator can mark it opted out.
//
// Earlier versions tried to read every reply and added a phrasing each time
// one was misread; each round found new misreadings in both directions. The
// design now makes an unrecognised phrasing land on needs_look rather than
// on a wrong automatic action: the rules only need to be *sure* before
// acting, not to understand everything.
//
// Precedence (the first step that applies decides):
//
//   0. Only the replier's own words are read: quoted history (">" lines,
//      "On … wrote:", Outlook header blocks), signatures ("-- ", "Sent from
//      my iPhone", a sign-off such as "Best," and the lines under it), legal
//      and newsletter footers ("This email is confidential…", "To
//      unsubscribe from our newsletter click here") and our own template's
//      "Reply STOP" footer are removed first (extractNewReplyText).
//   1. STOP REQUEST (STOP_COMMANDS, STOP_REQUESTS): an explicit request not
//      to be emailed ("STOP", "Remove me", "Please stop emailing me").
//        - it names only calls or texts ("stop calling my cell") → needs_look
//        - the reply also shows INTEREST anywhere                → needs_look,
//          with a reason naming both
//        - otherwise                                             → opt_out
//   2. STOP WORDS (STOP_CUES): a broad list of words that *can* be part of
//      asking not to be emailed ("exclude", "desist", "no further",
//      "didn't … email", "off … list", "rmv"). Never enough to opt out on
//      their own, but they keep a reply from counting as positive
//                                                                → needs_look
//                                                   ("may be asking not to be emailed")
//   3. DECLINE (DECLINE_PHRASES): "not interested", "wrong person", "who is
//      this", "spam"…                                            → needs_look
//   4. ANOTHER LANGUAGE: mostly not English                      → needs_look
//   5. INTEREST (INTEREST_SIGNALS, a question, a phone number, an email
//      address to use instead)                                   → positive
//   6. Nothing recognised                                        → needs_look
//
// Each rule group has example phrasings in RULE_EXAMPLES at the bottom of
// this file; tests/reply-classifier.test.ts asserts every one of them.
// REPLY_RULES_VERSION identifies these rules on every stored verdict.
// tests/heuristics-eval.test.ts scores the rules on labelled sets and
// reports how many replies land on needs_look.

import { rulesVersion } from "@/lib/outreach/rules-version";

export type ReplyVerdict = "opt_out" | "positive" | "needs_look";

export type ReplyClassification = {
  verdict: ReplyVerdict;
  /** verdict === "opt_out". */
  optOut: boolean;
  /** For an opt-out: the words that were read as one, for display on the lead. */
  trigger: string | null;
  /** For needs_look: one sentence saying why, for the lead page. Null otherwise. */
  review: string | null;
  /** For needs_look: the reply has words that may be asking not to be emailed. */
  mayBeOptOut: boolean;
  /** The replier's own text with quoted history, signatures and footers removed. */
  newText: string;
};

// --- 1. Stop requests (confident) ------------------------------------------
// A line on its own that means "opt me out" once filler words and
// punctuation are stripped.
const STOP_COMMANDS = new Set([
  "stop",
  "stop all",
  "stopall",
  "unsubscribe",
  "unsubscribe me",
  "unsubscribe us",
  "unsub",
  "remove",
  "remove me",
  "remove us",
  "optout",
  "opt out",
  "opt me out",
  "stop it",
  "stop this",
  "stop emailing",
  "stop emailing me",
  "stop sending",
  "no more emails",
  "no more",
  // Curt ways of saying the same.
  "enough",
  "enough already",
  "knock it off",
  "cut it out",
  "quit it",
  "go away",
  "leave us alone",
  "leave me alone",
  // Spanish and French one-word replies.
  "baja",
  "de baja",
  "darme de baja",
  "alto",
  "desuscribir",
  "desuscribirme",
  "cancelar suscripcion",
  "cancelar suscripción",
  "désabonner",
  "désabonnez moi",
  "desabonnez moi",
  "désinscrire",
  "désinscrivez moi",
  "arrêtez",
  "arretez",
]);
const FILLER_RE = /\b(please|pls|plz|kindly|thanks|thank you|thx|asap|now|por favor|gracias|merci|svp|sil vous plait|sil vous plaît)\b/g;

const ME = String.raw`(?:me|us|this\s+(?:e-?mail\s+)?(?:address|account|e-?mail))`;
const CONTACT_VERB = String.raw`(?:e-?mail|contact|message|text|write\s+to|reach\s+out\s+to|send\s+(?:me|us)\s+(?:any\s*more\s+|more\s+)?(?:e-?mails?|messages?|anything|stuff))`;
const NEG = String.raw`(?:do\s+not|don'?t|dont|never|please\s+don'?t)`;
const LIST = String.raw`(?:(?:your|the|this|all|any|every|ur)\s+)?(?:(?:e-?mail(?:ing)?|mailing|contact|distribution|marketing|call)\s+)?lists?`;

// Explicit requests anywhere in the new text.
const STOP_REQUESTS: RegExp[] = [
  // "Unsubscribe me", "Please unsubscribe", "I want to be unsubscribed" — the
  // word as a request, not "your unsubscribe link didn't work".
  /(?:^|[.!?]\s+|\b(?:please|pls|plz|kindly)\s+)unsubscribe\b(?!\s+(?:link|button|page|option|url))|\bunsubscribe\s+(?:me|us|this|my|our)\b|\b(?:want|like|wish|need)\s+to\s+(?:be\s+)?unsubscribed?\b/im,
  /\bopt(?:ing)?[\s-]?(?:me\s+)?out\b/i,
  // "remove me", "remove my email", "please remove from list"
  /\bremove\s+(?:me|us|my\s+(?:e-?mail|address|name|info)|this\s+(?:e-?mail|address))\b/i,
  new RegExp(String.raw`\bremove\s+(?:(?:me|us|it|this)\s+)?from\s+${LIST}\b`, "i"),
  /\btake\s+(?:me|us|(?:my|our)\s+(?:e-?mail(?:\s+address)?|address|name|office|team|company|business|firm))\s+off\b/i,
  // "I'd like to be removed from your mailing list", "we want to be removed from future emails"
  new RegExp(String.raw`\bbe\s+removed\s+from\s+(?:${LIST}|(?:your|all|any|future)\s+(?:e-?mails?|mailings?|messages?|contact))\b`, "i"),
  /\b(?:stop|quit|cease)\s+(?:e-?mailing|contacting|messaging|spamming|texting|calling|sending(?:\s+me)?(?:\s+(?:e-?mails?|these|this|messages?))?|writing\s+to|reaching\s+out)\b/i,
  // "don't email me", "do not contact us", "don't reach out to me again", "don't send me emails"
  new RegExp(
    String.raw`\b${NEG}\s+(?:ever\s+)?${CONTACT_VERB}(?:\s+${ME})?(?=\s+(?:again|anymore|any\s+more|ever)\b|\s*[.!,;]|\s*$)`,
    "im",
  ),
  new RegExp(
    String.raw`\b${NEG}\s+(?:ever\s+)?(?:e-?mail|contact|message|text|write\s+to|reach\s+out\s+to)\s+${ME}\b(?=\s+(?:at\s+(?:this|that|my|our)|here|going\s+forward|in\s+(?:the\s+)?future|from\s+now|with\s+(?:this|these|offers?|marketing)))`,
    "i",
  ),
  new RegExp(String.raw`\b${NEG}\s+(?:e-?mail|contact|message|reach\s+out|write)\s+(?:again|anymore|any\s+more)\b`, "i"),
  /\bno\s+more\s+(?:e-?mails?|messages?|contact)\b/i,
  // "do not send further emails", "don't send me anything else"
  new RegExp(
    String.raw`\b${NEG}\s+send\s+(?:(?:me|us)\s+)?(?:any\s*(?:more|thing)|further|more|other|anything(?:\s+else)?)(?:\s+(?:e-?mails?|messages?|stuff))?(?=\s*[.!,;]|\s*$|\s+(?:e-?mails?|messages?|again|to\s+(?:me|us|this)))`,
    "im",
  ),
  // "delete my email", "lose my address", "forget this email address", "scrub my email from your list"
  // "delete my email", "lose my address", "lose my number", "forget this email address", "scrub my email from your list"
  /\b(?:delete|erase|purge|lose|forget|scrub|drop)\s+(?:my|our|this)\s+(?:e-?mail(?:\s+address)?|address|info(?:rmation)?|contact(?:\s+(?:info|details))?|details|data|(?:(?:phone|cell|mobile)\s+)?number)\b(?!\s+(?:from\s+last|for\s+now|in(?:to)?\s|on\s|to\s))/i,
  /\b(?:delete|erase|scrub|drop)\s+(?:me|us)\s+from\b/i,
  // "I'd rather not receive these", "we'd prefer not to get your emails"
  /\b(?:i'?d|i\s+would|we'?d|we\s+would)\s+(?:rather|prefer)\s+not\s+(?:to\s+)?(?:receive|get|keep\s+(?:getting|receiving)|be\s+sent)\s+(?:(?:any\s*more|more|any|further)\s+(?:of\s+)?)?(?:these|this|them|those|your|such|e-?mails?|messages?|mails?|anything|stuff|spam|solicitations?)\b/i,
  // "I'd rather you didn't email me", "we'd prefer not to be contacted", "I'd rather not hear from you"
  /\b(?:i'?d|i\s+would|we'?d|we\s+would)\s+(?:rather|prefer)\s+(?:not\s+(?:to\s+)?(?:be\s+(?:e-?mailed|contacted|messaged|solicited|pitched)|hear\s+from\s+(?:you|u|your))|(?:that\s+|if\s+)?you\s+(?:didn'?t|did\s+not|not|don'?t|do\s+not|stop(?:ped)?)\s+(?:e-?mail|contact|messag|writ|send|reach))/i,
  // "Kindly refrain from contacting me", "please discontinue these emails", "don't bother emailing me"
  /\brefrain\s+from\s+(?:e-?mailing|contacting|messaging|writing|sending|reaching\s+out)\b/i,
  /\bdiscontinue\s+(?:(?:these|this|your|all|the|any|further)\s+)?(?:e-?mails?|messages?|mailings?|contact|e-?mailing|communications?|solicitations?)\b/i,
  new RegExp(String.raw`\b${NEG}\s+bother\s+(?:e-?mailing|contacting|messaging|writing|reaching\s+out|sending|following\s+up)\b`, "i"),
  // "Please don't send these anymore", "don't send your emails again"
  new RegExp(
    String.raw`\b${NEG}\s+send\s+(?:(?:me|us)\s+)?(?:these|this|them|those|your\s+(?:e-?mails?|messages?|stuff|offers?))(?:\s+(?:e-?mails?|messages?))?\s+(?:any\s*more|again|in\s+(?:the\s+)?future)\b`,
    "i",
  ),
  // Rude dismissals: "F off", "piss off", "get lost", "screw you".
  /\b(?:f+|f[u*#@$%-]+c?k?|fck|fk|eff|piss|bugger|sod|buzz|screw)[\s-]*off\b|\b(?:f+u+c+k+|f[*#@$%-]+k?|fck|screw)\s+(?:you|u|this|off)\b|(?:^|[.!?]\s*)(?:get\s+lost|take\s+a\s+hike|get\s+bent|go\s+to\s+hell|shove\s+it)\b|\bgo\s+(?:f+u+c+k+|f[*#@$%-]+k?|screw)\s+yourself\b/im,
  // Curt imperatives: "knock it off", "cut it out", "quit it with the emails"
  /\b(?:knock\s+it\s+off|cut\s+it\s+out|quit\s+it)\b/i,
  // "Enough with the emails", "Enough of these emails!" — at the start of a
  // sentence, so "we never get enough of these emails" doesn't count.
  /(?:^|[.!?]\s+|\bthat'?s\s+)enough\s+(?:with|of)\s+(?:the|these|this|your|all\s+(?:the|these|your))\s+(?:e-?mails?|messages?|spam|e-?mailing)\b/im,
  // "stop with the emails", "stop the emails"
  /\bstop\s+(?:with\s+)?(?:the|these|your|all\s+(?:the|these|your))\s+(?:e-?mails?|messages?|spam)\b/i,
  // "no more of these", "no more of your emails"
  /\bno\s+more\s+of\s+(?:these|this|your|them|those)\b/i,
  /^\s*go\s+away\b/im,
  /\bcease\s+and\s+desist\b/i,
  /\bleave\s+(?:me|us)\s+alone\b/i,
  // "I don't want these emails", "we do not wish to receive your messages",
  // "no longer want to get this kind of email" — but not "I don't want these
  // emails to stop" or "I don't want emails about Pinal, only Maricopa".
  new RegExp(
    String.raw`\b(?:(?:i|we)\s+(?:really\s+|just\s+|simply\s+)?)?(?:do\s+not|don'?t|dont|no\s+longer)\s+(?:want|wish|care)\s+(?:to\s+(?:receive|get|see|be\s+sent|keep\s+(?:getting|receiving))\s+)?(?:(?:any|more|some|all|none)\s+(?:more\s+)?of\s+)?(?:(?:any\s*more|any|more|your|these|this|such|those|the|further|future|all|ur)\s+)?(?:(?:kind|kinds|type|types|sort)\s+of\s+)?(?:(?:marketing|sales|promotional|cold|spam|junk)\s+)?(?:e-?mails?|messages?|mails?|solicitations?|pitches)\b(?!\s+to\s+(?:stop|end|cease|go\s+away)\b|\s+(?:about|on|regarding|for)\b)`,
    "i",
  ),
  /\b(?:do\s+not|don'?t|dont|no\s+longer)\s+(?:want|wish)\s+to\s+hear\s+from\s+(?:you|u|your\s+company)\b(?!\s+(?:until|before|unless))/i,
  // Spanish: "no me envíe más correos", "denme de baja", "quítenme de su
  // lista", "no quiero recibir más mensajes", "cancelar suscripción".
  /\b(?:dar(?:me|nos)?|d[eé]n?(?:me|nos)|doy|darse)\s+de\s+baja\b/i,
  /\bbaja\s+de\s+(?:la|su|sus|esta|tu|vuestra)\s+(?:lista|listas|base)\b/i,
  /\bno\s+(?:me|nos)\s+(?:env[ií](?:e|en|es)|mand(?:e|en|es)|escrib(?:a|an|as)|contact(?:e|en|es)|llam(?:e|en|es)|vuelva(?:n)?\s+a)\b/i,
  /\bno\s+(?:quiero|queremos|deseo|deseamos)\s+(?:recibir\s+|seguir\s+recibiendo\s+)?(?:m[aá]s\s+)?(?:sus\s+|tus\s+|estos\s+|sus\s+|ning[uú]n\s+)?(?:correos?|e-?mails?|emails?|mensajes?|publicidad)\b/i,
  /\b(?:b[oó]rre(?:n)?(?:me|nos)|elim[ií]ne(?:n)?(?:me|nos)|qu[ií]te(?:n)?(?:me|nos)|s[aá]que(?:n)?(?:me|nos))\s+de\s+(?:la|su|sus|esta|tu|vuestra)\s+(?:lista|listas|base)/i,
  /\bcancelar\s+(?:la\s+|mi\s+)?suscripci[oó]n\b/i,
  /\bno\s+m[aá]s\s+(?:correos|mensajes|e-?mails|emails)\b/i,
  // French: "désabonnez-moi", "ne m'envoyez plus de mails", "retirez-moi de
  // votre liste", "je ne souhaite plus recevoir vos messages".
  /\bd[ée]sabonn(?:er|ez|e)\b/i,
  /\bd[ée]sinscri(?:re|vez|s)\b/i,
  /\bne\s+(?:m'|me\s+|nous\s+)(?:envoyez|[ée]crivez|contactez|recontactez|sollicitez)\s+plus\b/i,
  /\b(?:retirez|supprimez|enlevez|rayez)[\s-](?:moi|nous)\b/i,
  /\b(?:retirez|supprimez|enlevez)\s+(?:mon|notre)\s+(?:adresse|e-?mail|courriel)\b/i,
  /\b(?:je|nous)\s+ne\s+(?:veux|voulons|souhaite|souhaitons|d[ée]sire)\s+plus\s+(?:recevoir|[êe]tre\s+contact[ée]s?)\b/i,
  // German: "Bitte keine E-Mails mehr", "abmelden", "nicht mehr kontaktieren".
  // Dutch: "afmelden", "uitschrijven", "geen e-mails meer".
  /\bkeine\s+(?:e-?mails?|mails?|nachrichten|werbung|newsletter|kontaktaufnahme)\b/i,
  /\b(?:abmelden|abbestellen|afmelden|uitschrijven)\b/i,
  /\bnicht\s+mehr\s+(?:kontaktieren|anschreiben|schreiben|mailen|e-?mailen|anrufen)\b/i,
  /\b(?:l[öo]schen|entfernen)\s+sie\s+(?:mich|uns|meine)\b/i,
  /\bgeen\s+(?:e-?mails?|mails?|berichten|reclame|nieuwsbrief)\b/i,
  // Portuguese: "não me envie mais e-mails", "descadastrar", "remova-me".
  /\bn[ãa]o\s+(?:me\s+|nos\s+)?(?:envie|enviem|mande|mandem|contate|contatem|contacte|contactem|escreva|escrevam)\s+mais/i,
  /\bdescadastr(?:ar|e|em)\b/i,
  /\bremov(?:a|am|er)[\s-](?:me|nos)\b/i,
  // Italian: "non inviatemi più email", "cancellatemi".
  /\bnon\s+(?:(?:mi|ci)\s+)?(?:invia|manda|scriv|contatta)\w*\s+pi[uù]/i,
  /\b(?:cancellatemi|cancellami|disiscrivetemi|disiscrivimi|rimuovetemi|rimuovimi)\b/i,
];

// A stop request that names only another channel ("stop calling my cell",
// "lose my number") and no email word isn't read as an email opt-out: it
// needs a look.
const OTHER_CHANNEL_RE = /\b(?:call(?:s|ing)?|phon(?:e|ing)|ring(?:ing)?|text(?:s|ing)?|sms|cell|mobile|number|voicemails?)\b/i;
const EMAIL_WORD_RE = /\b(?:e-?mails?|e-?mailing|mail(?:s|ing)?|messages?|messaging|list|unsubscribe|contact(?:ing)?|spam(?:ming)?)\b/i;

// "Can I unsubscribe later?", "can we opt out any time if it doesn't work?"
// ask about stopping in the future; they don't ask to stop (a stop word).
const ASKS_ABOUT_STOPPING_BEFORE_RE =
  /\b(?:(?:can|could|may|will)\s+(?:i|we)|is\s+(?:there\s+(?:a|any)\s+way|it\s+(?:possible|easy))|how\s+(?:easy|hard)\s+is\s+it|(?:am\s+i|are\s+we)\s+able)\s+(?:(?:to|still|always|easily|just)\s+)*$/i;
const LATER_RE = /\b(?:later|any\s*time|whenever|if|once|after|when|down\s+the\s+road)\b/i;

// --- 2. Stop words (a safety net, never an opt-out on their own) ---------------
// Deliberately broad: words and constructions that can be part of asking not
// to be emailed, however it is phrased. A reply containing one (not negated,
// as in "don't stop") never counts as positive; it needs a look, and the
// reason says it may be asking not to be emailed. Over-matching costs the
// operator a glance; under-matching could count an opt-out as a yes.
const STOP_CUES: RegExp[] = [
  // Verbs of stopping, removing and excluding ("stop by" is a visit).
  /\b(?:stop(?!\s+(?:by|in|over)\b)|quit|cease|desist|refrain|discontinue|halt|remove|removal|rmv|delete|erase|purge|scrub|exclude|unlist|blacklist|blocklist)\w*/i,
  /\bunsub\w*|\bopt(?:ed|ing)?[\s-]?out\b|\bcancel\w*/i,
  // "take me off", "want off this list", "off your mailing list"
  /\b(?:me|us|it|this|name|address|e-?mail|want)\s+off\b|\boff\s+(?:of\s+)?(?:your|the|this|that|ur|any|all|whatever)\s+(?:\w+\s+){0,2}lists?\b/i,
  // Lists and do-not-contact registers.
  /\b(?:mailing|e-?mail|distribution|contact|marketing|call)\s+lists?\b|\bdo[\s-]+not[\s-]+(?:contact|call|e-?mail|mail)\b|\bdnc\b/i,
  // A negated contact verb: "ask that you not contact me", "didn't email me",
  // "don't write again", "no further contact", "I do not wish to be contacted".
  /\b(?:not|never|don'?t|dont|didn'?t|did\s+not|do\s+not|nor|no\s+(?:more|further|longer))\b[^.!?\n]{0,30}?\b(?:e-?mail(?:s|ed|ing)?|contact(?:s|ed|ing)?|messag\w*|writ(?:e|ing)|send(?:ing)?|reach(?:ing)?\s+out|correspond\w*|solicit\w*|hear\s+from|mailings?|communications?)\b/i,
  /\bno\s+(?:more|further)\b/i,
  // "I never signed up for this", "I did not opt in".
  /\b(?:never|not|didn'?t|did\s+not)\s+(?:sign(?:ed)?\s+up|opt(?:ed)?[\s-]in|subscribed?|ask(?:ed)?\s+for\s+(?:this|these|it))\b/i,
  /\bleave\s+(?:me|us)\s+alone\b|\bharass\w*/i,
];

// --- 3. Declines and complaints -------------------------------------------------
// Not a request to stop, but not a yes either.
const DECLINE_PHRASES: { re: RegExp; reason: string }[] = [
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
  { re: /\bwrong\s+(?:person|e-?mail|address|contact|guy|gal)\b/i, reason: "says this is the wrong person" },
  {
    re: /\b(?:no\s+longer|not)\s+(?:work(?:ing)?\s+(?:here|there|at)|with\s+(?:the|this)\s+(?:company|brokerage|firm))\b/i,
    reason: "says they no longer work there",
  },
  {
    re: /\b(?:how|where)(?:\s+did|'d)\s+(?:you|u)\s+(?:get|find)\s+(?:my|this|our|me|us)\b|\bwho\s+gave\s+(?:you|u)\s+(?:my|this|our)\b/i,
    reason: "asks how we got their address",
  },
  { re: /\bwho(?:\s+is|'s)\s+this\b|\bwho\s+(?:are|r)\s+(?:you|u)\b(?!\s+(?:working|recommending))/i, reason: "asks who we are" },
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
    re: /\bnot\s+(?:the|a|an)\s+(?:right|good|great|ideal|best)\s+(?:fit|match|business|company|person|contact|audience|market|customer|client|time)\b|\b(?:doesn'?t|does\s+not|don'?t|do\s+not)\s+(?:apply|fit|make\s+sense)\s+(?:to|for)\s+(?:us|me|our)\b|\bnot\s+relevant\s+(?:to|for)\b/i,
    reason: "says it isn't for them",
  },
  // "Why do you keep emailing me?"
  {
    re: /\bwhy\s+(?:do|did|are|would|is|does)\s+(?:you|u|this|someone|your\s+company)\s+(?:keep\s+)?(?:e-?mail|contact|messag|writ|send|spam)/i,
    reason: "asks why we're emailing them",
  },
  { re: /\bnot\s+(?:currently\s+)?(?:looking\s+for|in\s+the\s+market)\b/i, reason: "says they're not looking" },
  {
    re: /\b(?:spam|spammer|spamming|unsolicited)\b(?!\s+(?:folder|filter|box|bin|tray))|\breport(?:ed|ing)?\s+(?:you|this|it)\b/i,
    reason: "calls the email spam",
  },
  { re: /\b(?:scam|scammer|scammy|fraud|phishing)\b/i, reason: "asks whether this is a scam" },
  { re: /\b(?:retired|passed\s+away|deceased)\b/i, reason: "says the person has retired or died" },
];

// A phrase right after one of these is being negated, not requested:
// "please don't stop emailing me", "I'm not asking to unsubscribe", "never
// stop sending these". Only filler words may sit between the negation and
// the phrase, so "I'm not interested, stop emailing me" still counts.
const NEGATION_BEFORE_RE =
  /\b(?:don'?t|dont|do\s+not|doesn'?t|does\s+not|never|not|no\s+need\s+to|won'?t|wouldn'?t|shouldn'?t)(?:\s+(?:please|ever|you|to|want|wanting|asking|ask|need|trying|going|mean|meaning|planning|plan))*\s*$/i;

/** Whether the words just before `index` (within the same clause) negate what follows. */
function isNegated(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 60), index);
  const clause = before.split(/[.!?;,\n]/).pop() ?? "";
  return NEGATION_BEFORE_RE.test(clause);
}

// --- 0. The replier's own words ---------------------------------------------------

// Our own footer, in case a client quotes it without ">" markers.
const TEMPLATE_FOOTER_RE = /don'?t want to hear from us again\?\s*reply stop and we won'?t email you again\.?/gi;

// Where quoted history starts: everything from here down is cut.
const QUOTE_HEADER_PATTERNS: RegExp[] = [
  /^\s*On\b[^\n]{0,300}?\bwrote:\s*$/im, // Gmail/Apple: "On Thu, Sep 25 … wrote:"
  /^\s*On\b[^\n]{0,300}\n[^\n]{0,300}\bwrote:\s*$/im, // same, wrapped onto two lines
  /^\s*-{2,}\s*(?:Original|Forwarded)\s+Message\s*-{2,}/im,
  /^\s*_{10,}\s*$/m, // Outlook's separator rule
  /^\s*From:\s.+\n(?:.*\n){0,3}?\s*(?:Sent|Date):\s/im, // Outlook header block
  /^\s*Le\s.+a\s+écrit\s*:\s*$/im,
];

// Where a signature or a mail footer starts: everything from here down is
// cut. A footer is boilerplate the replier's mail system adds (legal
// notices, a newsletter's unsubscribe line), so its "unsubscribe" or
// "confidential" is never the replier asking for anything.
const SIGNATURE_PATTERNS: RegExp[] = [
  /^--\s*$/m, // RFC 3676 signature delimiter
  /^\s*Sent from my\s.+$/im,
  /^\s*Get Outlook for\s.+$/im,
  /^\s*(?:confidentiality|privacy|legal)\s+(?:notice|statement|note|disclaimer)\b/im,
  /^\s*disclaimer\s*:/im,
  /^\s*(?:this|the\s+information\s+(?:contained\s+)?in\s+this)\s+(?:e-?mail|message|communication|transmission)\b[^\n]{0,200}?\b(?:confidential|privileged|intended\s+(?:only|solely)|intended\s+recipient)/im,
  /^\s*if\s+you\s+(?:are\s+not\s+the\s+intended|(?:have\s+)?received\s+this\s+(?:\S+\s+){0,2}in\s+error)/im,
  /^\s*(?:to\s+unsubscribe|unsubscribe|to\s+stop\s+receiving|you\s+(?:are\s+receiving|received)\s+this)\b[^\n]*\b(?:click|tap|link|preferences|manage\s+your|because\s+you)\b/im,
  /^\s*please\s+consider\s+the\s+environment\b/im,
];

// A sign-off line ("Best,", "Thanks,", "Regards") ends the message: the
// name, title and phone lines under it are a signature. A "P.S." after it
// is kept, since people put requests there.
const SIGN_OFF_RE =
  /^\s*(?:best|best\s+regards|kind\s+regards|warm\s+regards|warmly|regards|thanks|thank\s+you|many\s+thanks|thx|cheers|sincerely|respectfully|all\s+the\s+best|talk\s+soon)\s*[,.!]?\s*$/im;
const POSTSCRIPT_RE = /^\s*p\.?\s?s\.?\b/im;

/** The replier's own text: everything above quoted history, a signature or a footer. */
export function extractNewReplyText(raw: string): string {
  let text = (raw ?? "").replace(/\r\n?/g, "\n");

  let cut = text.length;
  for (const re of [...QUOTE_HEADER_PATTERNS, ...SIGNATURE_PATTERNS]) {
    const match = re.exec(text);
    if (match && match.index < cut) cut = match.index;
  }
  text = text.slice(0, cut);

  text = text
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n")
    .replace(TEMPLATE_FOOTER_RE, "");

  // A sign-off after some text of the reply's own ends it (bar a P.S.).
  const signOff = SIGN_OFF_RE.exec(text);
  if (signOff && text.slice(0, signOff.index).trim()) {
    const after = text.slice(signOff.index + signOff[0].length);
    const ps = POSTSCRIPT_RE.exec(after);
    text = text.slice(0, signOff.index) + (ps ? `\n${after.slice(ps.index)}` : "");
  }

  return text.trim();
}

function normalizeCommandLine(line: string): string {
  return line
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/'/g, "")
    .replace(FILLER_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripReplyPrefix(subject: string): string {
  return subject.replace(/^\s*((re|fw|fwd|aw)\s*:\s*)+/i, "").trim();
}

// --- 4. Another language ------------------------------------------------------------
// Common words that are distinctly another language (not also English), and
// common English words: a reply mostly in another language is flagged for a
// look rather than counted as a positive reply the rules didn't understand.
const FOREIGN_WORDS = new Set(
  (
    "el los las que y en por para con es su sus lo mi más mas pero gracias hola favor usted ustedes estoy este esta estos muy correo correos " +
    "nos del al una uno sí si señor señora quiero puede interesa llame llámeme bueno buenos buenas días tardes también " +
    "le les des du et est je vous nous une pour pas ne avec sur ce cette merci bonjour mon mes votre vos suis très oui cordialement madame monsieur " +
    // German, Italian, Portuguese, Dutch.
    "und der das ist nicht ich sie wir kein keine keinen danke bitte mit für auf nein mehr uns ihr ihre ihnen haben sind interesse vielen dank gerne schon noch aber oder wie " +
    "non grazie siamo sono il di che questo ci abbiamo interessati interessato niente più buongiorno salve " +
    "não obrigado obrigada temos você vocês nós também muito bom " +
    "geen niet wij het een graag bedankt hartelijk"
  ).split(" "),
);
const ENGLISH_WORDS = new Set(
  (
    "the and is i you we to of in it for this that with on my your are be not yes please thanks thank interested can what how send call " +
    "will would could do does have has sure sounds good great here there more info information price cost when time today tomorrow"
  ).split(" "),
);

// Below this many words a stop-word count says nothing about the language:
// "Y" (yes), "Si" or "Oui" is an answer, not a reply in another language.
const MIN_WORDS_FOR_LANGUAGE = 3;

/** True when most of the letters are in a non-Latin script (Cyrillic, Chinese, Arabic…). */
function isMainlyNonLatin(text: string): boolean {
  const letters = text.match(/\p{L}/gu) ?? [];
  const nonLatin = letters.filter((ch) => !/\p{Script=Latin}/u.test(ch)).length;
  return letters.length > 0 && nonLatin * 2 > letters.length;
}

/** True when the text reads as mainly another language rather than English. */
function isMainlyForeign(text: string): boolean {
  if (isMainlyNonLatin(text)) return true;
  const words = text.toLowerCase().match(/[\p{L}']+/gu) ?? [];
  if (words.length < MIN_WORDS_FOR_LANGUAGE) return false;
  let foreign = 0;
  let english = 0;
  for (const word of words) {
    if (FOREIGN_WORDS.has(word)) foreign++;
    else if (ENGLISH_WORDS.has(word)) english++;
  }
  return foreign > english && (foreign >= 2 || english === 0) && foreign >= 1;
}

/** A short reply ("Nein danke") with words from another language and none from English. */
function looksForeign(text: string): boolean {
  const words = text.toLowerCase().match(/[\p{L}']+/gu) ?? [];
  return words.some((w) => FOREIGN_WORDS.has(w)) && !words.some((w) => ENGLISH_WORDS.has(w));
}

// --- 5. Interest ---------------------------------------------------------------
// Signs of interest. A reply needs one of these (or a question) to count as positive.
const INTEREST_SIGNALS: RegExp[] = [
  // A yes: "Yes", "Sure", "OK", "Absolutely", "Sí", "Oui" opening a line, or "yes"/"yeah" anywhere.
  /^[\s"'(¡¿]*(?:y|ya|yes+|yeah|yep|yup|yea|sure|ok(?:ay)?|k|absolutely|definitely|certainly|of\s+course|please\s+do|go\s+ahead|deal|s[ií]|oui|ja|claro|d'accord)(?![\p{L}\p{N}])/imu,
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
const CONTACT_DETAIL_RE = /\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
// Asking something counts too ("What does it cost?", "Do you cover Mesa?").
const QUESTION_RE = /\?|^\s*(?:what|how|when|where|which|do|does|can|could|would|will|is|are)\b[^.!\n]*$/im;

// A positive signal right after one of these, in the same clause, is negated ("not that interested").
const NEGATION_WORD_RE =
  /\b(?:not|no|never|don'?t|dont|doesn'?t|didn'?t|did\s+not|isn'?t|aren'?t|won'?t|wouldn'?t|can'?t|cannot|nor|neither|without|hardly)\b/i;

// "Don't hesitate to email me the sample" and "don't forget to call me" aren't negations.
const NOT_A_NEGATION_RE = /\b(?:don'?t|dont|do\s+not|never)\s+(?:hesitate|forget|miss|wait)\b/gi;

// --- Deciding ---------------------------------------------------------------------

type Found = { index: number; text: string; /** How to name it in a reason, when not by quoting `text`. */ label?: string };

/** The first match of any of `patterns` in `text` that `accept` allows. */
function firstMatch(text: string, patterns: readonly RegExp[], accept: (m: Found) => boolean = () => true): Found | null {
  let best: Found | null = null;
  for (const re of patterns) {
    const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
    for (const match of text.matchAll(new RegExp(re.source, flags))) {
      const found = { index: match.index, text: match[0] };
      if (!accept(found)) continue;
      if (!best || found.index < best.index) best = found;
      break;
    }
  }
  return best;
}

/** A sign of interest not negated in its own clause ("not that interested" isn't one). */
function findInterest(text: string, { countQuestions }: { countQuestions: boolean }): Found | null {
  const signal = firstMatch(text, INTEREST_SIGNALS, ({ index }) => {
    const clause =
      text
        .slice(Math.max(0, index - 80), index)
        .split(/[.!?;,:\n—–]|\bbut\b/)
        .pop() ?? "";
    return !NEGATION_WORD_RE.test(clause.replace(NOT_A_NEGATION_RE, ""));
  });
  if (signal) return signal;
  const detail = CONTACT_DETAIL_RE.exec(text);
  if (detail) return { index: detail.index, text: detail[0], label: "gives a number or address to use" };
  if (countQuestions) {
    const question = QUESTION_RE.exec(text);
    if (question) return { index: question.index, text: question[0], label: "asks a question" };
  }
  return null;
}

/**
 * Whether `text` says yes or "interested" in so many words (not negated) —
 * a stronger sign than a question or a phone number, which out-of-office
 * messages also contain. Used to keep a reply that merely mentions being
 * out of the office from being filed as automatic (see inbound.ts).
 */
export function showsClearInterest(text: string): boolean {
  const own = extractNewReplyText(text).replace(/[‘’ʼ]/g, "'");
  return (
    firstMatch(own, INTEREST_SIGNALS.slice(0, 3), ({ index }) => {
      const clause =
        own
          .slice(Math.max(0, index - 80), index)
          .split(/[.!?;,:\n—–]|\bbut\b/)
          .pop() ?? "";
      return !NEGATION_WORD_RE.test(clause);
    }) !== null
  );
}

/** The first explicit stop request, or null. Negated ones and questions about stopping later don't count. */
function findStopRequest(text: string, subject: string): Found | null {
  // A line or sentence that is just the command ("STOP", "Remove me.").
  let lineStart = 0;
  for (const line of text.split("\n")) {
    for (const part of [line, ...line.split(/(?<=[.!?,;])\s+/)]) {
      if (STOP_COMMANDS.has(normalizeCommandLine(part))) return { index: lineStart + line.indexOf(part), text: part };
    }
    lineStart += line.length + 1;
  }
  const phrase = firstMatch(
    text,
    STOP_REQUESTS,
    ({ index, text: words }) =>
      !isNegated(text, index) && !(/^(?:unsubscribe|opt)/i.test(words.trim()) && asksAboutStoppingLater(text, index, words.length)),
  );
  if (phrase) return phrase;
  // A reply whose subject was changed to just "STOP"/"Unsubscribe".
  const bare = stripReplyPrefix(subject);
  if (bare && STOP_COMMANDS.has(normalizeCommandLine(bare))) return { index: -1, text: `Subject: ${bare}` };
  return null;
}

/** The first stop word that isn't negated ("don't stop sending these"). */
function findStopCue(text: string): Found | null {
  return firstMatch(text, STOP_CUES, ({ index, text: words }) => {
    // "Don't hesitate to email me" isn't a negation; otherwise the
    // negated-contact cue carries its own negation.
    if (new RegExp(`^${NOT_A_NEGATION_RE.source}`, "i").test(words)) return false;
    if (/^(?:not|never|don|dont|didn|did|do|nor|no)\b/i.test(words)) return true;
    return !isNegated(text, index);
  });
}

export function classifyReply(input: { subject?: string | null; text?: string | null }): ReplyClassification {
  const newText = extractNewReplyText(input.text ?? "");
  // Phones send curly apostrophes ("don’t"); the rules are written with
  // straight ones. Same length, so match positions still line up.
  const text = newText.replace(/[‘’ʼ]/g, "'");
  const interest = findInterest(text, { countQuestions: true });
  const quote = (found: Found) => (found.index < 0 ? found.text : sentenceAround(newText, found.index, found.text.length));
  const interested = (found: Found) => (found.label ? `also ${found.label}` : `also sounds interested (“${clip(found.text)}”)`);
  const base = { trigger: null, review: null, mayBeOptOut: false, newText };
  const needsLook = (review: string, mayBeOptOut = false): ReplyClassification => ({
    ...base,
    verdict: "needs_look",
    optOut: false,
    review,
    mayBeOptOut,
  });

  // 1. An explicit stop request.
  const stop = findStopRequest(text, input.subject ?? "");
  if (stop) {
    // Interest elsewhere in the reply — not the lead-in to the request
    // itself ("I'd like to be removed…" asks for nothing else).
    const clauseStart =
      stop.index < 0
        ? 0
        : Math.max(
            ...[".", "!", "?", ";", ",", "\n", "—", "–"].map((c) => text.lastIndexOf(c, stop.index - 1) + 1),
            text.lastIndexOf(" but ", stop.index) + 1,
            0,
          );
    const rest =
      stop.index < 0
        ? text
        : text.slice(0, clauseStart) + " ".repeat(stop.index + stop.text.length - clauseStart) + text.slice(stop.index + stop.text.length);
    const interest = findInterest(rest, { countQuestions: true });
    const email = stop.index < 0 || EMAIL_WORD_RE.test(stop.text) || !OTHER_CHANNEL_RE.test(stop.text);
    if (!email) {
      return needsLook(`It asks us to stop calls or texts (“${clip(stop.text)}”) — check whether it also means email.`, true);
    }
    if (interest) {
      return needsLook(
        `It reads like a request not to be emailed (“${clip(stop.text)}”) but ${interested(interest)} — check which they mean.`,
        true,
      );
    }
    return { ...base, verdict: "opt_out", optOut: true, trigger: quote(stop) };
  }

  if (!text.trim()) return needsLook("It has no text of its own (only the quoted email, a signature or a footer).");

  // 2. Words that may be part of asking not to be emailed.
  const cue = findStopCue(text);
  if (cue) {
    return needsLook(
      interest
        ? `It may be asking not to be emailed (“${clip(cue.text)}”), though it ${interested(interest)}.`
        : `It may be asking not to be emailed (“${clip(cue.text)}”).`,
      true,
    );
  }

  // 3. A decline or complaint.
  for (const { re, reason } of DECLINE_PHRASES) {
    if (re.test(text)) return needsLook(`It ${reason}.`);
  }

  // 4. Another language.
  if (isMainlyForeign(text) || (!interest && looksForeign(text))) {
    return needsLook("It is written in another language, so the rules can't read it — check whether it asks to stop.");
  }

  // 5. Interest.
  if (interest) return { ...base, verdict: "positive", optOut: false };

  // 6. Nothing recognised.
  return needsLook("It shows no clear yes, question or request.");
}

/** Whether the unsubscribe at `index` is asked about for later ("can I unsubscribe later if…?") rather than requested. */
function asksAboutStoppingLater(text: string, index: number, length: number): boolean {
  const clause =
    text
      .slice(Math.max(0, index - 60), index)
      .split(/[.!?;,\n]/)
      .pop() ?? "";
  if (!ASKS_ABOUT_STOPPING_BEFORE_RE.test(clause)) return false;
  const rest = text.slice(index + length);
  const end = rest.search(/[.!?\n]/);
  if (end === -1 || rest[end] !== "?") return false;
  return LATER_RE.test(rest.slice(0, end));
}

function clip(words: string): string {
  const flat = words.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? `${flat.slice(0, 80)}…` : flat;
}

function sentenceAround(text: string, index: number, length: number): string {
  const start = Math.max(text.lastIndexOf("\n", index) + 1, 0);
  const endNewline = text.indexOf("\n", index + length);
  const end = endNewline === -1 ? text.length : endNewline;
  const line = text.slice(start, end).trim();
  return line.length > 200 ? `${line.slice(0, 200)}…` : line;
}

/**
 * Example phrasings for each rule group, asserted by
 * tests/reply-classifier.test.ts: `verdict` is what classifyReply must
 * return for each. Add an example here whenever a group changes.
 */
export const RULE_EXAMPLES: { group: string; verdict: ReplyVerdict; examples: string[] }[] = [
  {
    group: "0. footers and signatures are not read",
    verdict: "positive",
    examples: [
      "Interested! Can you call me Thursday?\n\nThis email and any attachments are confidential. If you received this in error, please notify the sender and delete it. To unsubscribe from our newsletter click here.",
      "Yes, send it over.\n\nBest,\nJane Doe\nDesert Realty | Unsubscribe from our listings alerts",
      "Sounds good.\n\nDon't want to hear from us again? Reply STOP and we won't email you again.",
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
    ],
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
      "Please no further contact.",
      "Put me on your do not contact list",
      "Take this address off whatever list you bought.",
      "cancel my subscription to these emails",
      "Kindly desist from sending further emails.",
      "Pls rmv",
    ],
  },
  {
    group: "3. declines need a look",
    verdict: "needs_look",
    examples: ["Not interested.", "No thanks.", "You have the wrong person.", "How did you get my email?"],
  },
  {
    group: "4. another language needs a look",
    verdict: "needs_look",
    examples: ["Gracias, me interesa. Llámeme mañana.", "Nein danke."],
  },
  {
    group: "5. interest counts as positive",
    verdict: "positive",
    examples: [
      "Yes, interested — what does it cost?",
      "Tell me more.",
      "Call me at 480-555-0199.",
      "Sure, stop by the office Tuesday.",
      "👍",
    ],
  },
  {
    group: "6. nothing recognised needs a look",
    verdict: "needs_look",
    examples: ["We'll stick with what we have.", "Hmm.", "Please don't take this personally."],
  },
];

/**
 * Identifies this version of the reply rules; stored on every InboundReply.
 * Bump the revision when the logic above changes without a pattern or word
 * list changing.
 */
export const REPLY_RULES_VERSION = rulesVersion("reply", 4, [
  STOP_COMMANDS,
  FILLER_RE,
  STOP_REQUESTS,
  OTHER_CHANNEL_RE,
  EMAIL_WORD_RE,
  ASKS_ABOUT_STOPPING_BEFORE_RE,
  LATER_RE,
  STOP_CUES,
  DECLINE_PHRASES.map(({ re, reason }) => ({ re, reason })),
  INTEREST_SIGNALS,
  CONTACT_DETAIL_RE,
  QUESTION_RE,
  NEGATION_WORD_RE,
  NOT_A_NEGATION_RE,
  NEGATION_BEFORE_RE,
  TEMPLATE_FOOTER_RE,
  QUOTE_HEADER_PATTERNS,
  SIGNATURE_PATTERNS,
  SIGN_OFF_RE,
  POSTSCRIPT_RE,
  FOREIGN_WORDS,
  ENGLISH_WORDS,
  MIN_WORDS_FOR_LANGUAGE,
]);
