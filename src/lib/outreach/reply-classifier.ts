// Decides whether an inbound reply is a genuine opt-out request.
//
// Both outreach templates end with "Reply STOP and we won't email you
// again", and most mail clients quote the original message below a reply.
// Matching opt-out words anywhere in the body therefore flagged nearly
// every reply — including enthusiastic ones — as an opt-out. So:
//
// 1. Only the replier's own new text counts: quoted history (">" lines,
//    "On … wrote:", Outlook's "From:/Sent:" header blocks, "Original
//    Message" separators), signatures and our own template footer are cut.
// 2. What's left must *ask* not to be contacted: a line that is just the
//    command ("STOP", "Unsubscribe", "Please remove me"), or an explicit
//    phrase ("take me off your list", "don't email me", "quit contacting
//    us", "delete my email address", "leave me alone"), including curt ones
//    ("knock it off", "enough with the emails", "lose my email"). Ordinary uses of the
//    words ("stop by the office", "can't stop thinking about it") and
//    negated ones ("please don't stop sending these") don't count.
//    Polite and rude ones count ("I'd rather not receive these", "lose my
//    number", "F off"), and so do common Spanish, French, German,
//    Portuguese, Italian and Dutch ones ("no me envíe más correos",
//    "désabonnez-moi", "keine E-Mails mehr").
//    A stop request that isn't about email ("stop calling my cell") in a
//    reply that also sounds interested, or a question about unsubscribing
//    ("can I unsubscribe later if it doesn't work out?"), is flagged for a
//    look instead: suppressing it would silently lose an interested lead.
// 3. A reply that isn't an opt-out but reads like a brush-off or a
//    complaint ("not interested", "no, thank you", "we're all set", "not
//    for us", "who is this", "wrong person", "how did you get my email"),
//    or is mainly in another language, is flagged for a human
//    look (`review`) instead of being treated as an ordinary positive reply.
// 4. Everything else counts as a positive reply only when it shows a
//    positive signal: a yes, interest, a question, or a request (send
//    details, call me, let's talk). A reply the rules can't place ("We'll
//    stick with what we have", "Hmm.") is flagged for a look as `unclear`
//    rather than counted as a yes.
//
// REPLY_RULES_VERSION identifies these rules on every stored verdict.
//
// tests/reply-classifier.test.ts holds the development cases;
// tests/heuristics-eval.test.ts measures precision and recall on a
// separate labelled set and fails the build if they drop.

import { rulesVersion } from "@/lib/outreach/rules-version";

export type ReplyClassification = {
  optOut: boolean;
  /** The words that were read as an opt-out, for display on the lead. */
  trigger: string | null;
  /**
   * Not an opt-out, but worth a human look before treating it as a
   * positive reply: why, in words for the lead page. Null otherwise.
   */
  review: string | null;
  /**
   * True when `review` is set only because the reply showed no positive
   * signal (no yes, question or request) — not because it reads like a no.
   * Such a reply is only worth flagging on a lead we're waiting to hear
   * from; from a customer it's just conversation.
   */
  unclear: boolean;
  /** The replier's own text with quoted history and signatures removed. */
  newText: string;
};

// A line on its own that means "opt me out" once filler words and
// punctuation are stripped.
const COMMAND_WORDS = new Set([
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
const OPT_OUT_PHRASES: RegExp[] = [
  /\bunsubscribe\b/i,
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
    String.raw`\b${NEG}\s+(?:ever\s+)?(?:e-?mail|contact|message|text|write\s+to|reach\s+out\s+to)\s+${ME}\b(?!\s+(?:until|till|before|after|about|regarding|with\s+questions))`,
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

// A matched stop request that names only another channel ("stop calling
// my cell", "lose my number") and no email word. In a reply that also
// sounds interested it isn't read as an email opt-out: the lead is flagged
// for a look instead.
const OTHER_CHANNEL_RE = /\b(?:call(?:s|ing)?|phon(?:e|ing)|ring(?:ing)?|text(?:s|ing)?|sms|cell|mobile|number|voicemails?)\b/i;
const EMAIL_WORD_RE = /\b(?:e-?mails?|e-?mailing|mail(?:s|ing)?|messages?|messaging|list|unsubscribe|contact(?:ing)?|spam(?:ming)?)\b/i;

// "Can I unsubscribe later?", "can we opt out any time if it doesn't work?"
// ask about stopping in the future; they don't ask to stop.
const ASKS_ABOUT_STOPPING_BEFORE_RE =
  /\b(?:(?:can|could|may|will)\s+(?:i|we)|is\s+(?:there\s+(?:a|any)\s+way|it\s+(?:possible|easy))|how\s+(?:easy|hard)\s+is\s+it|(?:am\s+i|are\s+we)\s+able)\s+(?:(?:to|still|always|easily|just)\s+)*$/i;
const LATER_RE = /\b(?:later|any\s*time|whenever|if|once|after|when|down\s+the\s+road)\b/i;

// Not an opt-out on their own, but not a "yes" either: the lead is flagged
// for a look instead of being moved to Responded.
const REVIEW_PHRASES: { re: RegExp; reason: string }[] = [
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

// Our own footer, in case a client quotes it without ">" markers.
const TEMPLATE_FOOTER_RE = /don'?t want to hear from us again\?\s*reply stop and we won'?t email you again\.?/gi;

const QUOTE_HEADER_PATTERNS: RegExp[] = [
  /^\s*On\b[^\n]{0,300}?\bwrote:\s*$/im, // Gmail/Apple: "On Thu, Sep 25 … wrote:"
  /^\s*On\b[^\n]{0,300}\n[^\n]{0,300}\bwrote:\s*$/im, // same, wrapped onto two lines
  /^\s*-{2,}\s*(?:Original|Forwarded)\s+Message\s*-{2,}/im,
  /^\s*_{10,}\s*$/m, // Outlook's separator rule
  /^\s*From:\s.+\n(?:.*\n){0,3}?\s*(?:Sent|Date):\s/im, // Outlook header block
  /^\s*Le\s.+a\s+écrit\s*:\s*$/im,
];

const SIGNATURE_PATTERNS: RegExp[] = [
  /^--\s*$/m, // RFC 3676 signature delimiter
  /^\s*Sent from my\s.+$/im,
  /^\s*Get Outlook for\s.+$/im,
];

/** The replier's own text: everything above quoted history or a signature. */
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

// Common words that are distinctly Spanish or French (not also English), and
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

// What makes a reply count as positive. Without one of these, a reply that
// is neither an opt-out nor a recognised brush-off is flagged for a look.
const POSITIVE_SIGNALS: RegExp[] = [
  // A yes: "Yes", "Sure", "OK", "Absolutely", "Sí", "Oui" opening a line, or "yes"/"yeah" anywhere.
  /^[\s"'(¡¿]*(?:y|ya|yes+|yeah|yep|yup|yea|sure|ok(?:ay)?|k|absolutely|definitely|certainly|of\s+course|please\s+do|go\s+ahead|deal|s[ií]|oui|ja|claro|d'accord)(?![\p{L}\p{N}])/imu,
  /\b(?:yes|yeah|yep|yup|absolutely|definitely)\b/i,
  /\binterest(?:ed|ing)\b/i,
  // Asking for something: details, a sample, a call, pricing.
  /\b(?:send|e-?mail|forward|share|shoot)\s+(?:me|us|my|our|it|them|over|the|a|an|some|more|your|pricing|prices|details|info)\b/i,
  // Asking to be followed up with: "remind me in two weeks", "try me in January".
  /\bremind\s+(?:me|us)\b|\btry\s+(?:me|us)\s+(?:again|in|next|after)\b|\b(?:follow\s+up|check\s+back|circle\s+back)\s+(?:with\s+(?:me|us)\s+)?(?:in|next|after)\b/i,
  /\b(?:call|ring|phone|text)\s+(?:me|us|my|our|at|on|back|any\s*time|tomorrow|today|this|next|(?:mon|tues|wednes|thurs|fri|satur|sun)day)\b/i,
  /\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/, // a number to call
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
// Asking something counts too ("What does it cost?", "Do you cover Mesa?").
const QUESTION_RE = /\?|^\s*(?:what|how|when|where|which|do|does|can|could|would|will|is|are)\b[^.!\n]*$/im;

// A positive signal right after one of these, in the same clause, is negated ("not that interested").
const NEGATION_WORD_RE =
  /\b(?:not|no|never|don'?t|dont|doesn'?t|isn'?t|aren'?t|won'?t|wouldn'?t|can'?t|cannot|nor|neither|without|hardly)\b/i;

// "Don't hesitate to email me the sample" and "don't forget to call me" aren't negations.
const NOT_A_NEGATION_RE = /\b(?:don'?t|dont|do\s+not|never)\s+(?:hesitate|forget|miss|wait)\b/gi;

/** Whether `text` shows interest: a positive signal not negated in its clause, or (optionally) a question. */
function hasPositiveSignal(text: string, { countQuestions }: { countQuestions: boolean }): boolean {
  if (countQuestions && QUESTION_RE.test(text)) return true;
  for (const re of POSITIVE_SIGNALS) {
    const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
    for (const match of text.matchAll(new RegExp(re.source, flags))) {
      const clause =
        text
          .slice(Math.max(0, match.index - 80), match.index)
          .split(/[.!?;,:\n—–]|\bbut\b/)
          .pop() ?? "";
      if (!NEGATION_WORD_RE.test(clause.replace(NOT_A_NEGATION_RE, ""))) return true;
    }
  }
  return false;
}

/** `text` with the matched span blanked out, so the rest can be checked for interest. */
function without(text: string, index: number, length: number): string {
  return text.slice(0, index) + " ".repeat(length) + text.slice(index + length);
}

export function classifyReply(input: { subject?: string | null; text?: string | null }): ReplyClassification {
  const newText = extractNewReplyText(input.text ?? "");
  // Phones send curly apostrophes ("don’t"); the rules are written with
  // straight ones. Same length, so match positions still line up.
  const matchText = newText.replace(/[\u2018\u2019\u02BC]/g, "'");
  const optOut = (trigger: string): ReplyClassification => ({ optOut: true, trigger, review: null, unclear: false, newText });
  const review = (reason: string, index: number, length: number, unclear = false): ReplyClassification => ({
    optOut: false,
    trigger: null,
    review: `${reason}: “${sentenceAround(newText, index, length)}”`,
    unclear,
    newText,
  });

  // A line, or a sentence of one ("Not interested. Remove."), that is just
  // the command. One clause of a sentence ("Please stop, not interested")
  // counts too, unless the rest of the line sounds interested.
  for (const line of matchText.split("\n")) {
    const lineStart = matchText.indexOf(line);
    for (const part of [line, ...line.split(/(?<=[.!?])\s+/)]) {
      if (COMMAND_WORDS.has(normalizeCommandLine(part))) return optOut(line.trim());
    }
    for (const clause of line.split(/(?<=[,;])\s*/)) {
      if (!COMMAND_WORDS.has(normalizeCommandLine(clause))) continue;
      const at = line.indexOf(clause);
      if (hasPositiveSignal(without(line, at, clause.length), { countQuestions: false })) {
        return review("says stop but also sounds interested — check whether it's asking not to be emailed", lineStart, 0);
      }
      return optOut(line.trim());
    }
  }

  let asksAboutStopping: { index: number; length: number } | null = null;
  for (const re of OPT_OUT_PHRASES) {
    const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
    for (const match of matchText.matchAll(new RegExp(re.source, flags))) {
      if (isNegated(matchText, match.index)) continue;
      const phrase = match[0];
      // "Can I unsubscribe later if it doesn't work out?" asks about stopping.
      if (/^(?:unsubscribe|opt)/i.test(phrase.trim()) && asksAboutStoppingLater(matchText, match.index, phrase.length)) {
        asksAboutStopping ??= { index: match.index, length: phrase.length };
        continue;
      }
      // "How much for a website? Also please stop calling my cell" asks to
      // stop phone calls, not email, from someone who sounds interested.
      if (
        OTHER_CHANNEL_RE.test(phrase) &&
        !EMAIL_WORD_RE.test(phrase) &&
        hasPositiveSignal(without(matchText, match.index, phrase.length), { countQuestions: true })
      ) {
        return review(
          "asks us to stop phone calls or texts but also sounds interested — check whether it's asking not to be emailed",
          match.index,
          phrase.length,
        );
      }
      return optOut(sentenceAround(newText, match.index, phrase.length));
    }
  }

  // A reply whose subject was changed to just "STOP"/"Unsubscribe".
  const subject = stripReplyPrefix(input.subject ?? "");
  if (subject && COMMAND_WORDS.has(normalizeCommandLine(subject))) return optOut(`Subject: ${subject}`);

  if (asksAboutStopping) {
    return review(
      "asks about unsubscribing without asking to stop — check whether it's asking not to be emailed",
      asksAboutStopping.index,
      asksAboutStopping.length,
    );
  }

  for (const { re, reason } of REVIEW_PHRASES) {
    const match = re.exec(matchText);
    if (match) return review(reason, match.index, match[0].length);
  }

  if (isMainlyForeign(matchText)) {
    return review("is written in another language — check whether it asks to stop", 0, 0);
  }

  if (hasPositiveSignal(matchText, { countQuestions: true })) {
    return { optOut: false, trigger: null, review: null, unclear: false, newText };
  }

  // Nothing places it: don't count it as a yes.
  if (!matchText.trim()) {
    return { optOut: false, trigger: null, review: "has no text of its own (only the quoted email)", unclear: true, newText };
  }
  if (looksForeign(matchText)) {
    return review("may be written in another language — check whether it asks to stop", 0, 0, true);
  }
  return review("shows no clear sign of interest (no yes, question or request), so it may be a polite no", 0, 0, true);
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

function sentenceAround(text: string, index: number, length: number): string {
  const start = Math.max(text.lastIndexOf("\n", index) + 1, 0);
  const endNewline = text.indexOf("\n", index + length);
  const end = endNewline === -1 ? text.length : endNewline;
  const line = text.slice(start, end).trim();
  return line.length > 200 ? `${line.slice(0, 200)}…` : line;
}

/**
 * Identifies this version of the reply rules; stored on every InboundReply.
 * Bump the revision when the logic above changes without a pattern or word
 * list changing.
 */
export const REPLY_RULES_VERSION = rulesVersion("reply", 3, [
  COMMAND_WORDS,
  FILLER_RE,
  OPT_OUT_PHRASES,
  OTHER_CHANNEL_RE,
  EMAIL_WORD_RE,
  ASKS_ABOUT_STOPPING_BEFORE_RE,
  LATER_RE,
  POSITIVE_SIGNALS,
  QUESTION_RE,
  NEGATION_WORD_RE,
  NOT_A_NEGATION_RE,
  REVIEW_PHRASES.map(({ re, reason }) => ({ re, reason })),
  NEGATION_BEFORE_RE,
  TEMPLATE_FOOTER_RE,
  QUOTE_HEADER_PATTERNS,
  SIGNATURE_PATTERNS,
  FOREIGN_WORDS,
  ENGLISH_WORDS,
  MIN_WORDS_FOR_LANGUAGE,
]);
