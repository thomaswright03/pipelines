// Stop requests and stop words for the reply classifier (reply-classifier.ts,
// steps 1 and 2). Data only, plus the small helpers that read it.

// --- 1. Stop requests (confident) ------------------------------------------
// A line on its own that means "opt me out" once filler words and
// punctuation are stripped.
export const STOP_COMMANDS = new Set([
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
export const FILLER_RE =
  /\b(please|pls|plz|kindly|thanks|thank you|thx|asap|now|por favor|gracias|merci|svp|sil vous plait|sil vous plaît)\b/g;

const ME = String.raw`(?:me|us|this\s+(?:e-?mail\s+)?(?:address|account|e-?mail))`;
const CONTACT_VERB = String.raw`(?:e-?mail|contact|message|text|write\s+to|reach\s+out\s+to|send\s+(?:me|us)\s+(?:any\s*more\s+|more\s+)?(?:e-?mails?|messages?|anything|stuff))`;
const NEG = String.raw`(?:do\s+not|don'?t|dont|never|please\s+don'?t)`;
// What a formal stop request asks to end: "no further correspondence", "cease all communications".
const CORRESPONDENCE = String.raw`(?:e-?mails?|e-?mailing|messages?|contact|correspondence|communications?|mailings?|solicitations?|outreach)`;
const LIST = String.raw`(?:(?:your|the|this|all|any|every|ur)\s+)?(?:(?:e-?mail(?:ing)?|mailing|contact|distribution|marketing|call)\s+)?lists?`;

// Explicit requests anywhere in the new text.
export const STOP_REQUESTS: RegExp[] = [
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
    String.raw`\b${NEG}\s+(?:ever\s+)?${CONTACT_VERB}(?:\s+${ME})?(?=\s+(?:again|anymore|any\s+more|ever|further)\b|\s*[.!,;]|\s*$)`,
    "im",
  ),
  new RegExp(
    String.raw`\b${NEG}\s+(?:ever\s+)?(?:e-?mail|contact|message|text|write\s+to|reach\s+out\s+to)\s+${ME}\b(?=\s+(?:at\s+(?:this|that|my|our)|here|going\s+forward|in\s+(?:the\s+)?future|from\s+now|with\s+(?:this|these|offers?|marketing)))`,
    "i",
  ),
  new RegExp(String.raw`\b${NEG}\s+(?:e-?mail|contact|message|reach\s+out|write)\s+(?:again|anymore|any\s+more)\b`, "i"),
  // "No more emails", "no further correspondence please", "I request no further contact".
  new RegExp(String.raw`\bno\s+(?:more|further)\s+${CORRESPONDENCE}\b`, "i"),
  // "do not send further emails", "don't send me anything else"
  new RegExp(
    String.raw`\b${NEG}\s+send\s+(?:(?:me|us)\s+)?(?:any\s*(?:more|thing)|further|more|other|anything(?:\s+else)?)(?:\s+(?:e-?mails?|messages?|stuff))?(?=\s*[.!,;]|\s*$|\s+(?:e-?mails?|messages?|again|to\s+(?:me|us|this)))`,
    "im",
  ),
  // "Please do not send any further correspondence", "don't send us more communications"
  new RegExp(String.raw`\b${NEG}\s+send\s+(?:(?:me|us)\s+)?(?:any\s+)?(?:further|more|additional)\s+${CORRESPONDENCE}\b`, "i"),
  // "Cease all correspondence", "please discontinue all contact", "stop all further emails"
  new RegExp(String.raw`\b(?:cease|discontinue|halt|stop)\s+(?:all|any)\s+(?:further\s+)?${CORRESPONDENCE}\b`, "i"),
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

// "Yes, unsubscribe me", "Sure — remove me from your list", "OK. Remove me.":
// a yes that opens the reply and only introduces the stop request agrees to
// stopping; it isn't interest. Anything more before the request ("Yes, I'm
// interested, but remove this address") still pulls the other way.
export const ASSENT_LEAD_RE =
  /^\s*(?:yes+|yeah|yep|yup|yea|sure(?:\s+thing)?|ok(?:ay)?|k|absolutely|definitely|certainly|of\s+course|fine|alright|all\s+right|please\s+do|go\s+ahead)[\s,.!;:—–-]*(?:(?:please|pls|plz|kindly|just)\s+)*$/i;

// A stop request that names only another channel ("stop calling my cell",
// "lose my number") and no email word isn't read as an email opt-out: it
// needs a look.
export const OTHER_CHANNEL_RE = /\b(?:call(?:s|ing)?|phon(?:e|ing)|ring(?:ing)?|text(?:s|ing)?|sms|cell|mobile|number|voicemails?)\b/i;
export const EMAIL_WORD_RE =
  /\b(?:e-?mails?|e-?mailing|mail(?:s|ing)?|messages?|messaging|list|unsubscribe|contact(?:ing)?|spam(?:ming)?)\b/i;

// "Can I unsubscribe later?", "can we opt out any time if it doesn't work?"
// ask about stopping in the future; they don't ask to stop (a stop word).
export const ASKS_ABOUT_STOPPING_BEFORE_RE =
  /\b(?:(?:can|could|may|will)\s+(?:i|we)|is\s+(?:there\s+(?:a|any)\s+way|it\s+(?:possible|easy))|how\s+(?:easy|hard)\s+is\s+it|(?:am\s+i|are\s+we)\s+able)\s+(?:(?:to|still|always|easily|just)\s+)*$/i;
export const LATER_RE = /\b(?:later|any\s*time|whenever|if|once|after|when|down\s+the\s+road)\b/i;

// --- 2. Stop words (a safety net, never an opt-out on their own) ---------------
// Deliberately broad: words and constructions that can be part of asking not
// to be emailed, however it is phrased. A reply containing one (not negated,
// as in "don't stop") never counts as positive; it needs a look, and the
// reason says it may be asking not to be emailed. Over-matching costs the
// operator a glance; under-matching could count an opt-out as a yes.
export const STOP_CUES: RegExp[] = [
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

// A phrase right after one of these is being negated, not requested:
// "please don't stop emailing me", "I'm not asking to unsubscribe", "never
// stop sending these". Only filler words may sit between the negation and
// the phrase, so "I'm not interested, stop emailing me" still counts.
export const NEGATION_BEFORE_RE =
  /\b(?:don'?t|dont|do\s+not|doesn'?t|does\s+not|never|not|no\s+need\s+to|won'?t|wouldn'?t|shouldn'?t)(?:\s+(?:please|ever|you|to|want|wanting|asking|ask|need|trying|going|mean|meaning|planning|plan))*\s*$/i;

/** Whether the words just before `index` (within the same clause) negate what follows. */
export function isNegated(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 60), index);
  const clause = before.split(/[.!?;,\n]/).pop() ?? "";
  return NEGATION_BEFORE_RE.test(clause);
}

export function normalizeCommandLine(line: string): string {
  return line
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/'/g, "")
    .replace(FILLER_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function stripReplyPrefix(subject: string): string {
  return subject.replace(/^\s*((re|fw|fwd|aw)\s*:\s*)+/i, "").trim();
}
