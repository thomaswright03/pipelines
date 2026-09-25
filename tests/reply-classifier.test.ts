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
