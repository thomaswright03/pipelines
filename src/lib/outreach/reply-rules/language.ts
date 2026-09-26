// Replies in another language (reply-classifier.ts): the rules only read
// English, so a reply mostly in another language needs a look.

// Common words that are distinctly another language (not also English), and
// common English words: a reply mostly in another language is flagged for a
// look rather than counted as a positive reply the rules didn't understand.
export const FOREIGN_WORDS = new Set(
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
export const ENGLISH_WORDS = new Set(
  (
    "the and is i you we to of in it for this that with on my your are be not yes please thanks thank interested can what how send call " +
    "will would could do does have has sure sounds good great here there more info information price cost when time today tomorrow"
  ).split(" "),
);

// Below this many words a stop-word count says nothing about the language:
// "Y" (yes), "Si" or "Oui" is an answer, not a reply in another language.
export const MIN_WORDS_FOR_LANGUAGE = 3;

/** True when most of the letters are in a non-Latin script (Cyrillic, Chinese, Arabic…). */
function isMainlyNonLatin(text: string): boolean {
  const letters = text.match(/\p{L}/gu) ?? [];
  const nonLatin = letters.filter((ch) => !/\p{Script=Latin}/u.test(ch)).length;
  return letters.length > 0 && nonLatin * 2 > letters.length;
}

/** True when the text reads as mainly another language rather than English. */
export function isMainlyForeign(text: string): boolean {
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
export function looksForeign(text: string): boolean {
  const words = text.toLowerCase().match(/[\p{L}']+/gu) ?? [];
  return words.some((w) => FOREIGN_WORDS.has(w)) && !words.some((w) => ENGLISH_WORDS.has(w));
}
