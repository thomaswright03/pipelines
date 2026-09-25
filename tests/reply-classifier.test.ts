import { describe, expect, it } from "vitest";
import { classifyReply, extractNewReplyText } from "@/lib/outreach/reply-classifier";
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
    ["interested reply above Gmail-quoted pitch", `Yes! Very interested, can you call me tomorrow?\n\nOn Thu, Sep 25, 2026 at 8:33 AM Thomas Wright <thomas@wright-ai-solutions.com> wrote:\n${quoted(coldPitch)}`],
    ["interested reply with the header wrapped onto two lines", `Sounds good, send details.\n\nOn Thu, Sep 25, 2026 at 8:33 AM Thomas Wright <thomas@wright-ai-solutions.com>\nwrote:\n${quoted(agentPitch)}`],
    ["the finding's example payload", "Yes, interested!\n\nOn Thu … wrote:\n> Reply STOP and we won't email you again."],
    ["'stop by' as an ordinary phrase", "Sure, stop by the office Tuesday."],
    ["'can't stop' as an ordinary phrase", "Can't stop thinking about it — what does it cost?"],
    ["Outlook-style quoted header block", `Tell me more.\n\nFrom: Thomas Wright <thomas@wright-ai-solutions.com>\nSent: Thursday, September 25, 2026 8:33 AM\nTo: Acme\nSubject: I probably shouldn't have sent this\n\n${coldPitch}`],
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
    ["please stop, above the quoted pitch", `Please stop\n\nOn Thu, Sep 25, 2026 at 8:33 AM Thomas wrote:\n${quoted(coldPitch)}`, "Please stop"],
    ["unsubscribe sentence", "Please unsubscribe me from this list.", "Please unsubscribe me from this list."],
    ["remove me", "Not interested. Remove me from your list.", "Not interested. Remove me from your list."],
    ["take me off", "take me off your mailing list", "take me off your mailing list"],
    ["stop emailing", "Stop emailing me.", "Stop emailing me."],
    ["don't contact again", "Don't contact me again.", "Don't contact me again."],
    ["a negation earlier in the sentence doesn't hide a real request", "I'm not interested, stop emailing me.", "I'm not interested, stop emailing me."],
    ["a negated phrase followed by a real one", "Don't stop by. Please stop emailing me.", "Don't stop by. Please stop emailing me."],
    ["please stop emailing me", "Please stop emailing me", "Please stop emailing me"],
    // Plain requests not to be contacted, with or without "again".
    ["don't email me", "Don't email me.", "Don't email me."],
    ["do not contact me", "Do not contact me.", "Do not contact me."],
    ["not interested plus don't reach out again", "I'm not interested. Please don't reach out again.", "I'm not interested. Please don't reach out again."],
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
  ];
  for (const [label, text, reason] of cases) {
    it(label, () => {
      const result = classifyReply({ subject: "Re: Probate leads", text });
      expect(result.optOut).toBe(false);
      expect(result.review).toMatch(reason);
    });
  }

  it("an interested reply needs no look", () => {
    expect(classifyReply({ text: "Yes, send pricing please." }).review).toBeNull();
  });

  it("an opt-out wins over 'not interested'", () => {
    expect(classifyReply({ text: "Not interested, remove me." })).toMatchObject({ optOut: true, review: null });
  });
});
