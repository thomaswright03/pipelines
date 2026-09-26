import { describe, expect, it } from "vitest";
import { classifyReply, extractNewReplyText, RULE_EXAMPLES, showsClearInterest } from "@/lib/outreach/reply-classifier";
import { buildOutreachEmail } from "@/lib/vault-email-template";
import { buildAgentOutreachEmail } from "@/lib/dataleadsell-email-template";

function quoted(body: string): string {
  return body
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
}

const coldPitch = buildOutreachEmail("Acme Plumbing").body;
const agentPitch = buildAgentOutreachEmail("Jane Doe", "Maricopa").body;

describe("classifyReply — not opt-outs", () => {
  const cases: [string, string][] = [
    [
      "interested reply above Gmail-quoted pitch",
      `Yes! Very interested, can you call me tomorrow?\n\nOn Thu, Sep 25, 2026 at 8:33 AM Thomas Wright <thomas@wright-ai-solutions.com> wrote:\n${quoted(coldPitch)}`,
    ],
    [
      "interested reply with the header wrapped onto two lines",
      `Sounds good, send details.\n\nOn Thu, Sep 25, 2026 at 8:33 AM Thomas Wright <thomas@wright-ai-solutions.com>\nwrote:\n${quoted(agentPitch)}`,
    ],
    ["the finding's example payload", "Yes, interested!\n\nOn Thu … wrote:\n> Reply STOP and we won't email you again."],
    ["'stop by' as an ordinary phrase", "Sure, stop by the office Tuesday."],
    ["'can't stop' as an ordinary phrase", "Can't stop thinking about it — what does it cost?"],
    [
      "Outlook-style quoted header block",
      `Tell me more.\n\nFrom: Thomas Wright <thomas@wright-ai-solutions.com>\nSent: Thursday, September 25, 2026 8:33 AM\nTo: Acme\nSubject: I probably shouldn't have sent this\n\n${coldPitch}`,
    ],
    ["quote without markers or header, footer still present", `Interested, what's the price?\n\n${agentPitch}`],
    ["a 'no thanks' is a no, not an opt-out request", "No thanks, not interested right now."],
    ["'don't stop emailing me' is the opposite of an opt-out", "Please don't stop emailing me, this is great!"],
    ["'never stop sending these'", "Never stop sending these, they're gold."],
    ["'not asking to unsubscribe'", "I'm not asking to unsubscribe — just send pricing."],
    ["'do not want to opt out'", "I do not want to opt out, call me."],
    ["'please don't stop sending these'", "Please don't stop sending these."],
    ["'don't hesitate to email me'", "Don't hesitate to email me with the details."],
    ["'don't remove me from your list'", "Don't remove me from your list, I want the updates."],
    ["'I'm not asking you to leave me alone'", "I'm not asking you to leave me alone — just send less often."],
    ["'don't contact me until March'", "Busy season — don't contact me until March, then yes."],
    ["'I don't want these emails to stop'", "I don't want these emails to stop, they're useful."],
    ["'we don't want these messages to end'", "We don't want these messages to end!"],
    ["'don't want emails about' one county, only another", "I don't want emails about Pinal, only Maricopa."],
    ["'don't lose my email'", "Don't lose my email, I want the sample."],
    ["'never get enough of these emails'", "We never get enough of these emails, they're great."],
    ["'knock on wood'", "Knock on wood, this could work."],
    ["'go ahead'", "Go ahead and send the details."],
  ];
  for (const [label, text] of cases) {
    it(label, () => {
      expect(classifyReply({ subject: "Re: I probably shouldn't have sent this", text }).optOut).toBe(false);
    });
  }
});

describe("classifyReply — genuine opt-outs", () => {
  const cases: [string, string, string][] = [
    ["bare STOP", "STOP", "STOP"],
    ["STOP with punctuation and a signature", "Stop.\n\nSent from my iPhone", "Stop."],
    [
      "please stop, above the quoted pitch",
      `Please stop\n\nOn Thu, Sep 25, 2026 at 8:33 AM Thomas wrote:\n${quoted(coldPitch)}`,
      "Please stop",
    ],
    ["unsubscribe sentence", "Please unsubscribe me from this list.", "Please unsubscribe me from this list."],
    ["remove me", "Not interested. Remove me from your list.", "Not interested. Remove me from your list."],
    ["take me off", "take me off your mailing list", "take me off your mailing list"],
    ["stop emailing", "Stop emailing me.", "Stop emailing me."],
    ["don't contact again", "Don't contact me again.", "Don't contact me again."],
    [
      "a negation earlier in the sentence doesn't hide a real request",
      "I'm not interested, stop emailing me.",
      "I'm not interested, stop emailing me.",
    ],
    ["a negated phrase followed by a real one", "Don't stop by. Please stop emailing me.", "Don't stop by. Please stop emailing me."],
    ["please stop emailing me", "Please stop emailing me", "Please stop emailing me"],
    // Plain requests not to be contacted, with or without "again".
    ["don't email me", "Don't email me.", "Don't email me."],
    ["do not contact me", "Do not contact me.", "Do not contact me."],
    [
      "not interested plus don't reach out again",
      "I'm not interested. Please don't reach out again.",
      "I'm not interested. Please don't reach out again.",
    ],
    ["quit emailing me", "Quit emailing me", "Quit emailing me"],
    ["cease contacting", "Cease contacting this office.", "Cease contacting this office."],
    ["please remove from list", "please remove from list", "please remove from list"],
    ["remove this address from your list", "Remove this address from your mailing list.", "Remove this address from your mailing list."],
    ["delete my email address", "Delete my email address", "Delete my email address"],
    ["cease and desist", "This is a cease and desist.", "This is a cease and desist."],
    ["leave me alone", "Leave me alone", "Leave me alone"],
    ["don't contact us", "We're all set, don't contact us", "We're all set, don't contact us"],
    ["don't send me emails", "Please don't send me emails.", "Please don't send me emails."],
    ["don't message me anymore", "don't message me anymore thanks", "don't message me anymore thanks"],
    ["stop it", "Stop it!", "Stop it!"],
    ["do not send further emails", "Do not send further emails.", "Do not send further emails."],
    ["don't send me anything else", "Don't send me anything else.", "Don't send me anything else."],
    // "I don't want (these/this/any/your/such) emails" and "don't want to receive them".
    ["I don't want these emails", "I don't want these emails", "I don't want these emails"],
    ["with a phone's curly apostrophe", "I don\u2019t want these emails", "I don\u2019t want these emails"],
    ["I don't want this email", "I don't want this email.", "I don't want this email."],
    ["I don't want such emails", "Thanks but I don't want such emails.", "Thanks but I don't want such emails."],
    ["we don't want to receive your emails", "we don't want to receive your emails", "we don't want to receive your emails"],
    ["we do not wish to receive these messages", "We do not wish to receive these messages.", "We do not wish to receive these messages."],
    [
      "no longer want to get this kind of email",
      "I no longer want to get this kind of email.",
      "I no longer want to get this kind of email.",
    ],
    ["don't want to hear from you", "Don't want to hear from you again.", "Don't want to hear from you again."],
    // Spanish and French.
    ["Spanish: no me envíe más correos", "Por favor no me envíe más correos", "Por favor no me envíe más correos"],
    ["Spanish: denme de baja", "Denme de baja de su lista.", "Denme de baja de su lista."],
    ["Spanish: no quiero recibir más mensajes", "No quiero recibir más mensajes.", "No quiero recibir más mensajes."],
    ["Spanish: bare BAJA", "BAJA", "BAJA"],
    ["French: désabonnez-moi", "Désabonnez-moi", "Désabonnez-moi"],
    ["French: ne m'envoyez plus", "Merci de ne m'envoyez plus de courriels.", "Merci de ne m'envoyez plus de courriels."],
    ["French: je ne souhaite plus recevoir", "Je ne souhaite plus recevoir vos messages.", "Je ne souhaite plus recevoir vos messages."],
  ];
  for (const [label, text, trigger] of cases) {
    it(label, () => {
      const result = classifyReply({ subject: "Re: Probate leads", text });
      expect(result.optOut).toBe(true);
      expect(result.trigger).toBe(trigger);
    });
  }

  it("a subject changed to UNSUBSCRIBE", () => {
    const result = classifyReply({ subject: "Re: UNSUBSCRIBE", text: "" });
    expect(result).toMatchObject({ optOut: true, trigger: "Subject: UNSUBSCRIBE" });
  });
});

describe("extractNewReplyText", () => {
  it("keeps only the replier's words", () => {
    expect(extractNewReplyText(`Great, call me.\r\n\r\n-- \r\nJoe\r\n> quoted`)).toBe("Great, call me.");
  });
});

describe("classifyReply — replies that need a human look", () => {
  const cases: [string, string, RegExp][] = [
    ["a bare 'not interested'", "Not interested.", /not interested/],
    ["'no thanks'", "No thanks, I have a lead source already.", /no thanks/],
    ["wrong person", "You have the wrong person, Jane left the brokerage.", /wrong person/],
    ["how did you get my email", "How did you get my email?", /how we got their address/],
    ["spam", "This is spam.", /spam/],
    ["'No, thank you.' with a comma", "No, thank you.", /no thanks/],
    ["'not for us'", "Not for us, thanks", /isn't for them/],
    ["'we're good, no need'", "We're good, no need.", /all set/],
    ["'we don't need a website'", "We don't need a website.", /don't need it/],
    ["'who is this'", "Who is this?", /who we are/],
    ["a bare 'Nope.'", "Nope.", /says no/],
    ["'where'd you get my email' (contraction)", "Where'd you get my email?", /how we got their address/],
  ];
  for (const [label, text, reason] of cases) {
    it(label, () => {
      const result = classifyReply({ subject: "Re: Probate leads", text });
      expect(result.optOut).toBe(false);
      expect(result.review).toMatch(reason);
    });
  }

  it("a reply mainly in another language that isn't an opt-out", () => {
    for (const text of ["Gracias, me interesa. Llámeme mañana.", "Bonjour, oui ça m'intéresse, appelez-moi."]) {
      const result = classifyReply({ text });
      expect(result.optOut).toBe(false);
      expect(result.review).toMatch(/another language/);
    }
  });

  it("a one- or two-word answer is never read as another language", () => {
    for (const text of ["Y", "y", "Si", "Sí", "Oui", "Si, gracias"]) {
      expect(classifyReply({ text }).review, text).toBeNull();
    }
  });

  it("an English reply that greets in Spanish needs no look", () => {
    expect(classifyReply({ text: "Hola Thomas, yes I'm interested — send the price." }).review).toBeNull();
  });

  it("positive replies that share words with a brush-off need no look", () => {
    for (const text of [
      "No problem, send it over.",
      "No worries — Thursday works.",
      "We're good to go, send the link.",
      "I'm good with that price.",
      "I'll pass this along to my broker.",
      "No need to call, just email the pricing.",
    ]) {
      expect(classifyReply({ text }), text).toMatchObject({ optOut: false, review: null });
    }
  });

  it("an interested reply needs no look", () => {
    expect(classifyReply({ text: "Yes, send pricing please." }).review).toBeNull();
  });

  it("an opt-out wins over 'not interested'", () => {
    expect(classifyReply({ text: "Not interested, remove me." })).toMatchObject({ optOut: true, review: null });
  });
});

describe("classifyReply — a reply counts as positive only with a positive signal", () => {
  it.each(["I'd rather not receive these", "F off", "Bitte keine E-Mails mehr", "Get lost.", "Kindly refrain from contacting me."])(
    "reads the polite, rude or non-English stop request %j as an opt-out",
    (text) => {
      expect(classifyReply({ text })).toMatchObject({ optOut: true, review: null });
    },
  );

  it.each([
    ["Pass.", /pass/],
    ["We are not the right business for this", /isn't for them/],
    ["We'll stick with what we have.", /no clear yes, question or request/],
    ["Hmm.", /no clear yes, question or request/],
    ["Nein danke.", /another language/],
    ["Спасибо, не интересно.", /another language/],
  ])("flags %j for a look instead of counting it as a yes", (text, reason) => {
    const result = classifyReply({ text });
    expect(result.optOut).toBe(false);
    expect(result.review).toMatch(reason);
  });

  it("says when a reply that needs a look may be asking not to be emailed", () => {
    expect(classifyReply({ text: "Kindly exclude me from future mailings." })).toMatchObject({
      verdict: "needs_look",
      mayBeOptOut: true,
      review: expect.stringMatching(/may be asking not to be emailed/),
    });
    expect(classifyReply({ text: "Not interested." })).toMatchObject({ verdict: "needs_look", mayBeOptOut: false });
    expect(classifyReply({ text: "Yes, interested — what does it cost?" })).toMatchObject({ verdict: "positive", review: null });
  });

  it("flags a reply with no text of its own", () => {
    expect(classifyReply({ text: "\n\nOn Thu … wrote:\n> Hi there" }).review).toMatch(/no text of its own/);
  });

  it.each([
    "Yes, interested — what does it cost?",
    "Tell me more.",
    "Call me at 480-555-0199.",
    "Sounds good, send me the details.",
    "Great, thanks!",
    "Remind me in two weeks.",
    "Don't hesitate to email me the sample.",
    "👍",
  ])("counts %j as a positive reply", (text) => {
    expect(classifyReply({ text })).toMatchObject({ optOut: false, review: null });
  });

  it("doesn't let a negated signal count ('not that interested')", () => {
    expect(classifyReply({ text: "I'm not that interested." }).review).not.toBeNull();
  });
});

describe("classifyReply — a stop word in an interested reply", () => {
  it("flags 'stop calling my cell' in an interested reply for a look instead of opting out", () => {
    const result = classifyReply({ text: "How much for a website? Also please stop calling my cell, email only." });
    expect(result).toMatchObject({ verdict: "needs_look", optOut: false, mayBeOptOut: true });
    expect(result.review).toMatch(/stop calls or texts/);
  });

  it("opts out a stop request about email only when nothing in the reply sounds interested", () => {
    expect(classifyReply({ text: "Stop emailing me" }).verdict).toBe("opt_out");
    const mixed = classifyReply({ text: "Interesting product, but stop emailing me." });
    expect(mixed).toMatchObject({ verdict: "needs_look", mayBeOptOut: true });
    // The reason names both the request and the interest.
    expect(mixed.review).toMatch(/stop emailing.*Interesting/);
  });

  it("never opts out on a request that names only calls or texts", () => {
    for (const text of ["Stop calling me.", "Lose my number"]) {
      expect(classifyReply({ text }), text).toMatchObject({ verdict: "needs_look", mayBeOptOut: true });
    }
  });

  it("flags a question about unsubscribing for a look instead of opting out", () => {
    for (const text of ["Can I unsubscribe later if it doesn't work out?", "Can I unsubscribe?"]) {
      expect(classifyReply({ text }), text).toMatchObject({ verdict: "needs_look", mayBeOptOut: true });
    }
  });

  it("reads 'Please stop, not interested' as an opt-out but 'Stop, I'm interested' as needing a look", () => {
    expect(classifyReply({ text: "Please stop, not interested." }).optOut).toBe(true);
    expect(classifyReply({ text: "Stop, I'm interested — send pricing." })).toMatchObject({ optOut: false, review: expect.any(String) });
  });

  it("doesn't read 'your unsubscribe link' or 'don't email me the PDF' as a request", () => {
    expect(classifyReply({ text: "Your unsubscribe link didn't work but I want to stay on anyway." }).optOut).toBe(false);
    expect(classifyReply({ text: "Don't email me the PDF, just the link." }).optOut).toBe(false);
  });
});

describe("classifyReply — the review's examples (round 10)", () => {
  it.each([
    "Sure — but don't email me at this address, use jane@other.test instead.",
    "Please unsubscribe my old address and use this one going forward — send the pricing here.",
    "Stop! This is exactly what I need. Call me.",
    "Take me off the waitlist at my current vendor, I'd rather go with you. What's the price?",
  ])("an interested reply with opt-out words needs a look and names both: %j", (text) => {
    const result = classifyReply({ text });
    expect(result).toMatchObject({ verdict: "needs_look", optOut: false, mayBeOptOut: true });
    expect(result.review).toMatch(/request not to be emailed .* but also/);
  });

  it("reads past a legal and newsletter footer", () => {
    const text =
      "Interested! Can you call me Thursday?\n\nThis email and any attachments are confidential. If you received this in error, please notify the sender and delete it. To unsubscribe from our newsletter click here.";
    expect(classifyReply({ text })).toMatchObject({ verdict: "positive", newText: "Interested! Can you call me Thursday?" });
  });

  it.each(["STOP", "unsubscribe", "Remove me.", "Please stop emailing me. I am not interested in this at all."])(
    "still suppresses the unambiguous opt-out %j",
    (text) => {
      expect(classifyReply({ text }).verdict).toBe("opt_out");
    },
  );

  it.each([
    "I'd appreciate it if you didn't email me again.",
    "Kindly exclude me from future mailings.",
    "I do not wish to be contacted.",
    "Please no further contact.",
    "Put me on your do not contact list",
    "Take this address off whatever list you bought.",
    "cancel my subscription to these emails",
    "Kindly desist from sending further emails.",
    "Pls rmv",
  ])("never counts the polite or abbreviated opt-out %j as positive, and says it may be one", (text) => {
    const result = classifyReply({ text });
    expect(result.verdict).not.toBe("positive");
    if (result.verdict === "needs_look") expect(result.review).toMatch(/may be asking not to be emailed/);
  });
});

describe("extractNewReplyText — signatures and footers", () => {
  it("cuts a sign-off and the signature under it, but keeps a P.S.", () => {
    expect(extractNewReplyText("Send the pricing.\n\nBest,\nDana Whitfield\nWhitfield Realty\n(602) 555-0142")).toBe("Send the pricing.");
    expect(extractNewReplyText("Sounds good.\nThanks,\nJo\nP.S. remove my old address from your list")).toBe(
      "Sounds good.\n\nP.S. remove my old address from your list",
    );
  });

  it("keeps a sign-off word that is the whole reply", () => {
    expect(extractNewReplyText("Thanks!")).toBe("Thanks!");
  });

  it.each([
    "CONFIDENTIALITY NOTICE: This e-mail message is for the sole use of the intended recipient.",
    "This message and any attachments are confidential and intended solely for the addressee.",
    "If you have received this email in error please notify the sender.",
    "To unsubscribe from the Desert Realty newsletter, click here.",
    "Please consider the environment before printing this email.",
  ])("cuts the footer line %j", (footer) => {
    expect(extractNewReplyText(`Yes, call me.\n\n${footer}`)).toBe("Yes, call me.");
  });

  it("doesn't mistake a request to unsubscribe for a newsletter footer", () => {
    expect(extractNewReplyText("Not interested.\nUnsubscribe me from your newsletter.")).toBe(
      "Not interested.\nUnsubscribe me from your newsletter.",
    );
  });
});

describe("rule groups", () => {
  for (const { group, verdict, examples } of RULE_EXAMPLES) {
    it.each(examples)(`${group}: %j → ${verdict}`, (text) => {
      expect(classifyReply({ text }).verdict).toBe(verdict);
    });
  }
});

describe("showsClearInterest", () => {
  it("is true for a yes or 'interested', not for a phone number or a negated one", () => {
    expect(showsClearInterest("Yes I'm interested, I'm out of the office this week but call me Monday")).toBe(true);
    expect(showsClearInterest("I am out of the office until Monday. For urgent matters call 480-555-0100.")).toBe(false);
    expect(showsClearInterest("Out of office. Not interested in solicitations.")).toBe(false);
  });
});
