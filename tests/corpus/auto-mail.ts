// Labelled sets for the automatic-reply and bounce detectors
// (src/lib/outreach/auto-mail.ts), scored by tests/heuristics-eval.test.ts.
//
// Provenance: SYNTHETIC messages in the shapes Outlook/Exchange, Gmail,
// Apple Mail, helpdesk autoresponders and common MTAs (Postfix, Exim,
// Exchange, Gmail) produce — not real people's mail. Extend with anonymised
// real cases from the InboundReply table (docs/measuring-rules.md).
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
//
// Round 6 (2026-09-25): both held-out splits grown to 50 with fresh cases,
// scored as-is. Automatic replies: precision 93.1%, recall 90.0% (two more
// "we'll get back to you" autoresponders missed; "Precedence: bulk" on a
// person's reply and a subject changed to "Re: out of office stuff" read as
// automatic). Bounces: precision 97.1%, recall 100% — a person's
// "Re: Undeliverable?" reply read as a bounce. That was a real gap (a
// server's notice never starts "Re:"), fixed from a new development case,
// so that one held-out case no longer measures anything new.
//
// Round 7 (2026-09-26): 14 fresh automatic-reply cases (helpdesk "thank
// you for contacting … we'll get back to you" acknowledgements, weak
// Precedence headers on a person's reply, subjects a person wrote) written
// before the rules changed. Before: 64 cases, precision 82.9%, recall 78.4%.
// After ("Precedence: bulk/junk" alone no longer counts; a subject must be
// an out-of-office subject, not merely start with the words; acknowledgement
// wording with a time frame counts; the reviewers' phrasings went to
// AUTO_REPLY_DEV): precision 100%, recall 91.9% — the three misses were
// contraction bugs ("We'll", "We've", "…and will respond"), then fixed
// (100% / 100%), so those three no longer measure anything new. Same
// author wrote the batch and the rules.

// Round 14 (2026-10-05): the second batch (formerly "held-out", now
// `AUTO_REPLY_DEV_2, BOUNCE_DEV_2`) has been printed miss by miss on every CI run and fixed against,
// so it is scored as a second development batch. A genuinely unseen
// measure needs real cases (docs/measuring-rules.md).

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
  // Round 7, from the reviewers' reports.
  { subject: "Re: hello", text: "Thank you for contacting Acme Plumbing! We will get back to you shortly.", auto: true },
  { subject: "Re: hello", text: "Thank you for your inquiry. Our team will respond within one business day.", auto: true },
  { subject: "Re: hello", text: "Sure.", headers: { Precedence: "bulk" }, auto: false },
  { subject: "Re: out of office stuff", text: "Tell me more.", auto: false },
];

export const AUTO_REPLY_DEV_2: LabelledAutoReply[] = [
  {
    subject: "Automatic reply: Quick question for Mesa agents",
    text: "Hello, I'm out of the office through Friday. For urgent matters call 602-555-0142.",
    auto: true,
  },
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
  // Fresh batch, 2026-09-25 (round 6), written before scoring and scored as-is.
  { subject: "Automatic reply: Probate leads for Pima County", text: "Thanks for your email. I'm on PTO until Monday.", auto: true },
  { subject: "Out of Office: Re: hello", text: "I am currently out of the office with no access to email.", auto: true },
  { subject: "Re: Quick question", text: "Thanks!", headers: { "Auto-Submitted": "auto-replied (vacation)" }, auto: true },
  { subject: "Re: Quick question", text: "Got it.", headers: { "X-Autoreply": "YES" }, auto: true },
  { subject: "Re: Quick question", text: "Noted.", headers: { Precedence: "auto_reply" }, auto: true },
  { subject: "Autoreply: hello", text: "", auto: true },
  { subject: "Auto-response: your message", text: "We have received your inquiry.", auto: true },
  { subject: "OOO", text: "Back on the 5th.", auto: true },
  { subject: "Re: hello", text: "I am out of the office until October 12 and will respond upon my return.", auto: true },
  { subject: "Re: hello", text: "I'm on holiday until 3 November.", auto: true },
  { subject: "Re: hello", text: "I will be away from the office from Sept 28 through Oct 2.", auto: true },
  { subject: "Re: hello", text: "I'm currently away from my desk with limited email access.", auto: true },
  { subject: "Re: hello", text: "This is an automated message. Please do not reply.", auto: true },
  { subject: "Re: hello", text: "Thank you for your inquiry. We will respond within 24 hours.", auto: true },
  { subject: "Respuesta automática: hola", text: "Estoy fuera de la oficina.", auto: true },
  { subject: "Réponse automatique : Quick question", text: "Absent jusqu'au 5 octobre.", auto: true },
  { subject: "Re: hello", text: "Thanks for reaching out! We'll get back to you as soon as possible.", auto: true },
  { subject: "Re: hello", text: "Hi, I'm out of office thru Tuesday.", auto: true },
  { subject: "Re: hello", text: "Hello — I'm on paternity leave until January.", auto: true },
  { subject: "Vacation reply", text: "Gone fishing.", auto: true },
  { subject: "Re: hello", text: "Hi Thomas, I was on vacation last week. What does it cost?", auto: false },
  { subject: "Re: hello", text: "Yes, call me when you're back from lunch.", auto: false },
  { subject: "Re: hello", text: "I'm out of town but interested. Email details.", auto: false },
  { subject: "Re: hello", text: "Thanks for reaching out. What counties?", auto: false },
  { subject: "Re: hello", text: "Take me off your list.", auto: false },
  { subject: "Re: hello", text: "My office is closed Fridays; call Monday.", auto: false },
  { subject: "Re: hello", text: "Thank you, I'll respond after I talk to my broker.", auto: false },
  { subject: "Re: automation for agents", text: "Interested in the automated leads — send pricing.", auto: false },
  { subject: "Re: hello", text: "Sure.", headers: { Precedence: "bulk" }, auto: false },
  { subject: "Re: hello", text: "Who is this from?", headers: { "Auto-Submitted": "no" }, auto: false },
  { subject: "Re: out of office stuff", text: "Ha, I thought this was spam at first. Tell me more.", auto: false },
  { subject: "Re: hello", text: "Away from the phone today, email is best.", auto: false },
  // Fresh batch, 2026-09-26 (round 7): helpdesk-style "thank you for
  // contacting … we'll get back to you" autoresponders, weak headers on a
  // person's reply, and subjects a person wrote. Written before the rules
  // changed; see the header for the scores.
  {
    subject: "Re: hello",
    text: "Thank you for contacting Mesa Home Team. A member of our team will get back to you within one business day.",
    auto: true,
  },
  {
    subject: "Re: Quick question",
    text: "Thanks for getting in touch! We've received your message and will respond as soon as we can.",
    auto: true,
  },
  { subject: "Re: hello", text: "Thank you for your email. Our office will reply within 48 hours.", auto: true },
  { subject: "Re: hello", text: "We have received your message and will get back to you shortly.", auto: true },
  {
    subject: "Re: hello",
    text: "Thank you for reaching out to Sun Valley Realty. Someone will contact you during business hours.",
    auto: true,
  },
  { subject: "Out of Office Reply", text: "Back Monday.", auto: true },
  { subject: "Re: hello", text: "Thanks for your message! Our team will follow up shortly.", headers: { Precedence: "bulk" }, auto: true },
  { subject: "Re: hello", text: "Yes please.", headers: { Precedence: "bulk" }, auto: false },
  { subject: "Re: hello", text: "Ok.", headers: { Precedence: "junk" }, auto: false },
  { subject: "Re: out of office tomorrow", text: "I'm out tomorrow, can we talk Thursday?", auto: false },
  { subject: "Re: autoresponder setup?", text: "Do you also set up autoresponders for agents?", auto: false },
  { subject: "Re: hello", text: "Thanks for reaching out — I'll get back to you after I check with my partner.", auto: false },
  { subject: "Re: hello", text: "Thank you for contacting me. What's the monthly cost?", auto: false },
  { subject: "Re: hello", text: "Yep.", auto: false },
];

const POSTFIX = [
  "This is the mail system at host mx.example.",
  "",
  "I'm sorry to have to inform you that your message could not be delivered to one or more recipients.",
  "",
  "<RECIPIENT>: host mx.example said: 550 5.1.1 <RECIPIENT>: Recipient address rejected: User unknown",
].join("\n");

export const BOUNCE_DEV: LabelledBounce[] = [
  {
    from: "MAILER-DAEMON@mx.davedeli.example",
    subject: "Undelivered Mail Returned to Sender",
    text: POSTFIX.replace(/RECIPIENT/g, "dave@davedeli.example"),
    bounce: true,
    recipient: "dave@davedeli.example",
  },
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
  {
    from: "pat@shop.example",
    subject: "Re: hello",
    text: "Your email to my partner could not be delivered, try bob@shop.example",
    bounce: false,
  },
  // Added after the round-6 held-out batch: a person replying to a subject that says "Undeliverable".
  {
    from: "lee@shop.example",
    subject: "Re: Undeliverable mail",
    text: "Nothing undeliverable here, it reached me. Interested.",
    bounce: false,
  },
];

export const BOUNCE_DEV_2: LabelledBounce[] = [
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
  {
    from: "notifications@corp.example",
    subject: "Undeliverable",
    text: "",
    headers: { "X-Failed-Recipients": "lee@corp.example" },
    bounce: true,
    recipient: "lee@corp.example",
  },
  {
    from: "postmaster@mail.example",
    subject: "Delivery Status Notification (Failure)",
    text: "Delivery to the following recipients failed permanently:\n\n     tom@homes.example\n\nTechnical details of permanent failure: 550 5.7.1 rejected",
    bounce: true,
    recipient: "tom@homes.example",
  },
  { from: "tom@homes.example", subject: "Re: Undeliverable?", text: "Your last email came through fine, what's the cost?", bounce: false },
  { from: "mary@realty.example", subject: "Re: hello", text: "My old address is no longer in use, use this one.", bounce: false },
  // Fresh batch, 2026-09-25 (round 6), written before scoring and scored as-is.
  {
    from: "MAILER-DAEMON@mail.brokerage.example",
    subject: "Undelivered Mail Returned to Sender",
    text: POSTFIX.replace(/RECIPIENT/g, "kim@brokerage.example"),
    bounce: true,
    recipient: "kim@brokerage.example",
  },
  {
    from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
    subject: "Delivery Status Notification (Failure)",
    text: "** Address not found **\n\nYour message wasn't delivered to rick@plumbing.example because the address couldn't be found, or is unable to receive mail.",
    bounce: true,
    recipient: "rick@plumbing.example",
  },
  {
    from: "postmaster@outlook.com",
    subject: "Undeliverable: Probate leads for Maricopa",
    text: "Your message to nina@homes.example couldn't be delivered.\n\nnina wasn't found at homes.example.\n\nRemote Server returned '550 5.1.10 RESOLVER.ADR.RecipientNotFound; Recipient not found by SMTP address lookup'",
    bounce: true,
    recipient: "nina@homes.example",
  },
  {
    from: "Mail Delivery System <MAILER-DAEMON@smtp.host.example>",
    subject: "Mail delivery failed: returning message to sender",
    text: "This message was created automatically by mail delivery software.\n\nA message that you sent could not be delivered to one or more of its recipients. This is a permanent error. The following address(es) failed:\n\n  owner@bakery.example\n    mailbox is full: retry timeout exceeded",
    bounce: true,
    recipient: "owner@bakery.example",
  },
  {
    from: "postmaster@relay.example",
    subject: "Delivery Status Notification",
    text: "Reporting-MTA: dns; relay.example\nFinal-Recipient: rfc822; carl@landscaping.example\nAction: failed\nStatus: 5.1.1\nDiagnostic-Code: smtp; 550 5.1.1 user unknown",
    bounce: true,
    recipient: "carl@landscaping.example",
  },
  {
    from: "MAILER-DAEMON@yahoo.com",
    subject: "Failure Notice",
    text: "Sorry, we were unable to deliver your message to the following address.\n\n<joan@yahoo.example>:\n554: delivery error: dd This user doesn't have a yahoo.com account",
    bounce: true,
    recipient: "joan@yahoo.example",
  },
  {
    from: "bounces@mailer.example",
    subject: "Undeliverable",
    text: "",
    headers: { "X-Failed-Recipients": "pete@hvac.example" },
    bounce: true,
    recipient: "pete@hvac.example",
  },
  {
    from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
    subject: "Delivery Status Notification (Failure)",
    text: "Message blocked\n\nYour message to lucy@salon.example has been blocked. 550 5.7.1 Message rejected due to local policy.",
    bounce: true,
    recipient: "lucy@salon.example",
  },
  {
    from: "postmaster@exchange.example",
    subject: "Undeliverable: hello",
    text: "Delivery has failed to these recipients or groups:\n\nsales@autobody.example\nThe email address you entered couldn't be found.",
    bounce: true,
    recipient: "sales@autobody.example",
  },
  {
    from: "MAILER-DAEMON@mx.example",
    subject: "Returned mail: User unknown",
    text: "The original message was received from [10.0.0.1]\n\n----- The following addresses had permanent fatal errors -----\n<info@dental.example>\n    (reason: 550 5.1.1 User unknown)",
    bounce: true,
    recipient: "info@dental.example",
  },
  {
    from: "gary@roofing.example",
    subject: "Re: hello",
    text: "Your first email bounced off our old server but this one got through. Interested.",
    bounce: false,
  },
  { from: "ops@realty.example", subject: "Re: Delivery failure?", text: "No failure on our side, we got it. Price?", bounce: false },
  { from: "anne@cafe.example", subject: "Re: hello", text: "Please send to my other address, this inbox is almost full.", bounce: false },
  { from: "support@helpdesk.example", subject: "Re: hello", text: "Ticket #1234 created. A human will reply soon.", bounce: false },
  {
    from: "MAILER-DAEMON@mx1.pool.example",
    subject: "Undelivered Mail Returned to Sender",
    text: "This is the mail system at host mx1.pool.example.\n\n<dan@pools.example>: host mx.pools.example said: 550 5.1.1 User unknown",
    bounce: true,
    recipient: "dan@pools.example",
  },
  {
    from: "mailer-daemon@googlemail.com",
    subject: "Delivery Status Notification (Failure)",
    text: "Address not found\n\nYour message wasn't delivered to hello@yoga.example because the domain yoga.example couldn't be found.",
    bounce: true,
    recipient: "hello@yoga.example",
  },
  {
    from: "postmaster@outlook.com",
    subject: "Undeliverable: Quick question for Tempe agents",
    text: "Delivery has failed to these recipients or groups:\n\nbeth@tempehomes.example\nThe recipient's mailbox is full and can't accept messages now.",
    bounce: true,
    recipient: "beth@tempehomes.example",
  },
  {
    from: "MAILER-DAEMON@exim.example",
    subject: "Mail delivery failed: returning message to sender",
    text: "The following address(es) failed:\n\n  front@auto.example\n    550 5.1.1 unknown user",
    bounce: true,
    recipient: "front@auto.example",
  },
  {
    from: "postmaster@relay2.example",
    subject: "Returned mail: see transcript for details",
    text: "Final-Recipient: rfc822; mo@cleaning.example\nAction: failed\nStatus: 5.1.1",
    bounce: true,
    recipient: "mo@cleaning.example",
  },
  {
    from: "MAILER-DAEMON@aol.com",
    subject: "Failure Notice",
    text: "Sorry, we were unable to deliver your message to the following address.\n\n<pat@aol.example>:\n554: delivery error: This user doesn't have an account",
    bounce: true,
    recipient: "pat@aol.example",
  },
  {
    from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
    subject: "Delivery Status Notification (Failure)",
    text: "The response from the remote server was:\n550 5.2.1 The email account that you tried to reach is disabled. <ken@contractor.example>",
    bounce: true,
    recipient: "ken@contractor.example",
  },
  {
    from: "postmaster@exch.corp.example",
    subject: "Undeliverable: Probate leads",
    text: "Your message to ella@corp.example couldn't be delivered.\n\n550 5.4.1 Recipient address rejected: Access denied.",
    bounce: true,
    recipient: "ella@corp.example",
  },
  {
    from: "MAILER-DAEMON@mail.isp.example",
    subject: "Undelivered Mail Returned to Sender",
    text: "<gus@bar.example>: host mx.bar.example[1.2.3.4] said: 550 5.1.1 <gus@bar.example>... User unknown",
    bounce: true,
    recipient: "gus@bar.example",
  },
  {
    from: "bounce@mta.example",
    subject: "Delivery failure",
    text: "Reporting-MTA: dns; mta.example\nFinal-Recipient: rfc822;ivy@spa.example\nAction: failed\nStatus: 5.0.0\nDiagnostic-Code: smtp; 550 No such mailbox",
    bounce: true,
    recipient: "ivy@spa.example",
  },
  {
    from: "MAILER-DAEMON@mx.example",
    subject: "Returned mail: Host unknown",
    text: "----- The following addresses had permanent fatal errors -----\n<owner@closedshop.example>\n    (reason: 550 Host unknown)",
    bounce: true,
    recipient: "owner@closedshop.example",
  },
  {
    from: "Mail Delivery System <MAILER-DAEMON@host.example>",
    subject: "Undelivered Mail Returned to Sender",
    text: "I'm sorry to have to inform you that your message could not be delivered to one or more recipients.\n\n<al@deli.example>: 552 5.2.2 Mailbox quota exceeded",
    bounce: true,
    recipient: "al@deli.example",
  },
  {
    from: "postmaster@yahoo.example",
    subject: "Delivery Status Notification (Failure)",
    text: "Delivery to the following recipient failed permanently:\n\n     sue@yahoo.example\n\n554 5.7.9 Message not accepted for policy reasons.",
    bounce: true,
    recipient: "sue@yahoo.example",
  },
  {
    from: "mailer-daemon@mail.example",
    subject: "Undeliverable mail",
    text: "This message was created automatically by mail delivery software.\n\nA message that you sent could not be delivered to one or more of its recipients. This is a permanent error.\n\n  info@gone.example\n    Domain gone.example has no MX record",
    bounce: true,
    recipient: "info@gone.example",
  },
  {
    from: "MAILER-DAEMON@smtp.example",
    subject: "Mail delivery failed",
    text: "permanent error. The following address(es) failed:\n\n  sam.lee@realty.example",
    bounce: true,
    recipient: "sam.lee@realty.example",
  },
  {
    from: "postmaster@outlook.com",
    subject: "Undeliverable: hello",
    text: "Delivery has failed to these recipients or groups:\n\nmark.t@remax.example\nThe email address you entered couldn't be found.\n\nRemote Server returned '550 5.1.10 RESOLVER.ADR.RecipientNotFound'",
    bounce: true,
    recipient: "mark.t@remax.example",
  },
  {
    from: "relay@notify.example",
    subject: "Message not delivered",
    text: "",
    headers: { "X-Failed-Recipients": "zoe@bakery.example" },
    bounce: true,
    recipient: "zoe@bakery.example",
  },
  {
    from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
    subject: "Delivery Status Notification (Failure)",
    text: "Recipient inbox full\n\nYour message couldn't be delivered to lou@plumb.example. Their inbox is full, or it's getting too much mail right now.",
    bounce: true,
    recipient: "lou@plumb.example",
  },
  {
    from: "MAILER-DAEMON@mx.host.example",
    subject: "Undelivered Mail Returned to Sender",
    text: "<ray@hvac.example>: host mx.hvac.example said: 550-5.1.1 The email account that you tried to reach does not exist.",
    bounce: true,
    recipient: "ray@hvac.example",
  },
  {
    from: "postmaster@mail.example",
    subject: "Returned mail",
    text: "Final-Recipient: rfc822; fay@nails.example\nAction: failed\nStatus: 5.1.2\nDiagnostic-Code: smtp; 550 5.1.2 Bad destination mailbox address",
    bounce: true,
    recipient: "fay@nails.example",
  },
  {
    from: "jim@garage.example",
    subject: "Re: hello",
    text: "Got your email fine. I think my colleague's bounced though? Send to jim@garage.example again.",
    bounce: false,
  },
  {
    from: "kate@realty.example",
    subject: "Re: Undeliverable?",
    text: "Not undeliverable — I'm right here. What's the price?",
    bounce: false,
  },
  {
    from: "office@dental.example",
    subject: "Re: hello",
    text: "Dr. Wu is no longer with the practice. Please contact office@dental.example.",
    bounce: false,
  },
  { from: "tony@cafe.example", subject: "Re: hello", text: "My inbox is full most days, so text me instead: 602-555-0100.", bounce: false },
  {
    from: "mail@shop.example",
    subject: "Re: hello",
    text: "Your message was delivered to the right person. We'll call you.",
    bounce: false,
  },
  {
    from: "dee@salon.example",
    subject: "Delivery failure on your side?",
    text: "I tried to reply yesterday and it failed. Trying again: interested!",
    bounce: false,
  },
  {
    from: "noreply@calendar.example",
    subject: "Invitation: call with Thomas",
    text: "You have been invited to a call on Tuesday.",
    bounce: false,
  },
  { from: "jo@spa.example", subject: "Re: hello", text: "Returned from vacation, sorry for the delay. Yes please.", bounce: false },
  { from: "rob@roof.example", subject: "Re: mail delivery", text: "Postmaster here as well as owner, ha. Tell me more.", bounce: false },
  { from: "amy@florist.example", subject: "Re: hello", text: "Failure is not an option! Let's do it.", bounce: false },
];
