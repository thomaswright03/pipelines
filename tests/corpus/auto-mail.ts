// Labelled sets for the automatic-reply and bounce detectors
// (src/lib/outreach/auto-mail.ts), scored by tests/heuristics-eval.test.ts.
//
// Provenance: SYNTHETIC messages in the shapes Outlook/Exchange, Gmail,
// Apple Mail, helpdesk autoresponders and common MTAs (Postfix, Exim,
// Exchange, Gmail) produce — not real people's mail. Extend with anonymised
// real cases from the InboundReply table (README → "Measuring the reply
// and address rules").
//
// Splits: `*_DEV` are the cases the rules were written against (the unit
// tests in tests/auto-mail.test.ts are development cases too). `*_HELD_OUT`
// were written separately, scored once as-is, and are never used when
// changing the rules — a miss there is recorded, not patched.
//
// First run of the held-out splits (2026-09-25): automatic replies
// precision 100%, recall 90% (missed "Thank you for contacting Desert
// Realty! We will get back to you shortly." — a person could write that, so
// without an autoresponder header it stays a reply); bounces 100% / 100%.

import type { MailHeaders } from "@/lib/outreach/auto-mail";

export type LabelledAutoReply = { subject: string; text: string; headers?: MailHeaders; auto: boolean };
export type LabelledBounce = { from: string; subject: string; text: string; headers?: MailHeaders; bounce: boolean; recipient?: string };

export const AUTO_REPLY_DEV: LabelledAutoReply[] = [
  { subject: "Automatic reply: Probate leads for Maricopa", text: "I am out of the office until Monday, September 28.", auto: true },
  { subject: "Out of Office: Quick question", text: "Thank you for your email. I am currently out of the office.", auto: true },
  { subject: "Auto-Reply: hello", text: "Thanks for reaching out!", auto: true },
  { subject: "Re: Quick question", text: "Thanks for your note.", headers: { "Auto-Submitted": "auto-replied" }, auto: true },
  { subject: "Re: Quick question", text: "Received.", headers: { "X-Autoreply": "yes" }, auto: true },
  { subject: "Re: Quick question", text: "We got it.", headers: { Precedence: "auto_reply" }, auto: true },
  { subject: "Re: hello", text: "I'm on vacation through 10/3 and will reply when I return.", auto: true },
  { subject: "Re: hello", text: "I am away from the office with limited access to email.", auto: true },
  { subject: "Re: hello", text: "This is an automated response. We will respond within one business day.", auto: true },
  { subject: "Autoreply", text: "", auto: true },
  { subject: "Re: hello", text: "Away until Oct 5.", auto: true },
  { subject: "Re: hello", text: "Yes, interested — what does it cost?", auto: false },
  { subject: "Re: hello", text: "Not interested, thanks.", auto: false },
  { subject: "Re: hello", text: "I was out of the office last week, sorry for the slow reply. Send details?", auto: false },
  { subject: "Re: hello", text: "STOP", auto: false },
  { subject: "Re: hello", text: "Who is this?", auto: false },
  { subject: "Re: hello", text: "Call me at 480-555-0100.", headers: { "Auto-Submitted": "no" }, auto: false },
  { subject: "Re: hello", text: "Thanks, forwarding to our office manager.", headers: { Precedence: "list" }, auto: false },
];

export const AUTO_REPLY_HELD_OUT: LabelledAutoReply[] = [
  { subject: "Automatic reply: Quick question for Mesa agents", text: "Hello, I'm out of the office through Friday. For urgent matters call 602-555-0142.", auto: true },
  { subject: "Out of office", text: "I will be out of the office from 9/28 to 10/2 with no access to email.", auto: true },
  { subject: "RE: Probate leads", text: "Thank you for your message.", headers: { "auto-submitted": "auto-generated" }, auto: true },
  { subject: "Re: Probate leads", text: "Hi!", headers: { "X-Autorespond": "true" }, auto: true },
  { subject: "Re: hello", text: "Thanks.", headers: { "X-Auto-Response-Suppress": "All" }, auto: true },
  { subject: "Réponse automatique : bonjour", text: "Je suis absent du bureau.", auto: true },
  { subject: "Re: hello", text: "I'm currently on maternity leave and will respond upon my return in November.", auto: true },
  { subject: "Re: hello", text: "Thank you for contacting Desert Realty! We will get back to you shortly.", auto: true },
  { subject: "Auto Response", text: "Your message has been received.", auto: true },
  { subject: "Re: hello", text: "I'm away until the 14th, then happy to chat.", auto: true },
  { subject: "Re: hello", text: "Sounds great, let's talk Tuesday.", auto: false },
  { subject: "Re: hello", text: "I'm heading out of town tomorrow but yes, send it over.", auto: false },
  { subject: "Re: hello", text: "Please remove me from your list.", auto: false },
  { subject: "Re: hello", text: "Wrong person, Jane retired.", auto: false },
  { subject: "Re: hello", text: "Got your auto-reply thing, very funny. What's the price?", auto: false },
  { subject: "Re: hello", text: "Out of curiosity, where does the data come from?", auto: false },
  { subject: "Re: office hours", text: "We're open 9 to 5, come by.", auto: false },
  { subject: "Re: hello", text: "Back in the office now — interested.", auto: false },
];

const POSTFIX = [
  "This is the mail system at host mx.example.",
  "",
  "I'm sorry to have to inform you that your message could not be delivered to one or more recipients.",
  "",
  "<RECIPIENT>: host mx.example said: 550 5.1.1 <RECIPIENT>: Recipient address rejected: User unknown",
].join("\n");

export const BOUNCE_DEV: LabelledBounce[] = [
  { from: "MAILER-DAEMON@mx.davedeli.example", subject: "Undelivered Mail Returned to Sender", text: POSTFIX.replace(/RECIPIENT/g, "dave@davedeli.example"), bounce: true, recipient: "dave@davedeli.example" },
  {
    from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
    subject: "Delivery Status Notification (Failure)",
    text: "Address not found\n\nYour message wasn't delivered to jane@shop.example because the address couldn't be found.",
    bounce: true,
    recipient: "jane@shop.example",
  },
  {
    from: "postmaster@outlook.com",
    subject: "Undeliverable: Quick question",
    text: "Delivery has failed to these recipients or groups:\n\nbob@corp.example\n\nRemote Server returned '550 5.1.10 RESOLVER.ADR.RecipientNotFound'",
    bounce: true,
    recipient: "bob@corp.example",
  },
  { from: "pat@shop.example", subject: "Re: hello", text: "Interested!", bounce: false },
  { from: "pat@shop.example", subject: "Re: hello", text: "Your email to my partner could not be delivered, try bob@shop.example", bounce: false },
];

export const BOUNCE_HELD_OUT: LabelledBounce[] = [
  {
    from: "Mail Delivery System <Mailer-Daemon@exim.host.example>",
    subject: "Mail delivery failed: returning message to sender",
    text: "This message was created automatically by mail delivery software.\n\nA message that you sent could not be delivered to one or more of its recipients. This is a permanent error. The following address(es) failed:\n\n  ann@realty.example\n    SMTP error from remote mail server after RCPT TO:<ann@realty.example>:\n    550 5.1.1 No such user",
    bounce: true,
    recipient: "ann@realty.example",
  },
  {
    from: "bounce@relay.example",
    subject: "Returned mail: see transcript for details",
    text: "Reporting-MTA: dns; relay.example\nFinal-Recipient: rfc822; sam@x.example\nAction: failed\nStatus: 5.2.2\nDiagnostic-Code: smtp; 552 5.2.2 Mailbox full",
    bounce: true,
    recipient: "sam@x.example",
  },
  { from: "notifications@corp.example", subject: "Undeliverable", text: "", headers: { "X-Failed-Recipients": "lee@corp.example" }, bounce: true, recipient: "lee@corp.example" },
  {
    from: "postmaster@mail.example",
    subject: "Delivery Status Notification (Failure)",
    text: "Delivery to the following recipients failed permanently:\n\n     tom@homes.example\n\nTechnical details of permanent failure: 550 5.7.1 rejected",
    bounce: true,
    recipient: "tom@homes.example",
  },
  { from: "tom@homes.example", subject: "Re: Undeliverable?", text: "Your last email came through fine, what's the cost?", bounce: false },
  { from: "mary@realty.example", subject: "Re: hello", text: "My old address is no longer in use, use this one.", bounce: false },
];
