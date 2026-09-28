// The replier's own words (reply-classifier.ts, step 0): quoted history,
// signatures, sign-offs, legal and newsletter footers and our own
// template's footer are cut before any rule reads a reply.

// Our own footer, in case a client quotes it without ">" markers.
export const TEMPLATE_FOOTER_RE = /don'?t want to hear from us again\?\s*reply stop and we won'?t email you again\.?/gi;

// Where quoted history starts: everything from here down is cut.
export const QUOTE_HEADER_PATTERNS: RegExp[] = [
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
export const SIGNATURE_PATTERNS: RegExp[] = [
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
export const SIGN_OFF_RE =
  /^\s*(?:best|best\s+regards|kind\s+regards|warm\s+regards|warmly|regards|thanks|thank\s+you|many\s+thanks|thx|cheers|sincerely|respectfully|all\s+the\s+best|talk\s+soon)\s*[,.!]?\s*$/im;
export const POSTSCRIPT_RE = /^\s*p\.?\s?s\.?\b/im;

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
