# How outreach is kept safe

These rules live once in `src/lib/outreach/` and every send path goes through them: the lead-page button,
the bulk send, and the daily cron.

- **One pitch per address.** Each send first claims the address in the `OutreachRecipient` ledger. The claim
  happens inside a transaction that holds a Postgres advisory lock on that address, and it commits before
  any SMTP call.
  - Two sends that overlap (two tabs, or a cron run and a click) can't both email the same address.
  - If the process dies after sending, the address is never pitched again.
  - Addresses are compared lower-cased.
  - By default an address gets one pitch across **both** pipelines. **Settings → Same address in both
    pipelines** allows one pitch per pipeline instead.
- **First pitch only to New leads.** The server refuses a send for any other status and says why.
- **Refused addresses leave the queue.** When the recipient's mail server refuses an address for good (a
  5xx at RCPT TO, such as "550 5.1.1 User unknown", or a 5.1.x/5.2.x mailbox status), the ledger keeps the
  address as `refused` so it is never tried again from any lead, and the lead is flagged **Address refused
  by the mail server** with the server's reason; editing the address clears it. A temporary refusal (4xx)
  is retried by later sends and treated the same way after 3 tries. Refusals don't count toward the bulk
  send's "email service failed three times" stop, don't make a daily run partial and don't change
  **Settings → Connections**; they are named in the bulk-send summary and the run summary. Every failed
  or delivery-unknown attempt adds an entry to the lead's History and a **Last send failed** marker to its
  row in the lead list, until a send succeeds.
- **Only addresses tied to the lead.** Discovery guesses a website from the lead's name (Yelp and ADRE
  don't give one). An address found on a guessed site is saved only if that site also shows the lead's
  phone number or street address from Yelp/ADRE, or its city together with a second, independent sign
  that the site is this lead's — the lead's distinctive name words in the page title, or (for an agent on
  their brokerage's site) an address carrying the agent's own name — on a site that lists no other
  locations (`src/lib/outreach/site-evidence.ts`). A mention of the city alone isn't enough: a chain, a
  franchise or a same-named business in the same city would pass it and get the lead's one pitch. The evidence is saved on the lead
  and shown on its page as **Why this address**. An uncorroborated find is not saved (a manual **Find
  email** reports it, so the operator can check it and enter it by hand).
  - For agents whose only site is their brokerage's, an address there is used only if it names that agent:
    the surname as a whole token together with the first name or initial (`john.doe@`, `jdoe@`,
    `doej@`, `johndoe@`). `john@`, `johnson@`, `john.smith@`, `doe.family@`, team or assistant inboxes
    (`jdoe.team@`) and shared inboxes (`info@`, `frontdesk@`) are refused (`src/lib/outreach/email-policy.ts`).
  - A website that times out, drops the connection or answers with a 5xx is **not** a "no address"
    verdict. The lead stays New and unchecked, **Find email** says the site couldn't be reached, and the
    bulk lookup and the ADRE import try it again an hour later. Only a finished scan with no usable
    address sends a lead to phone outreach.
  - **Find email** refuses for a lead that already has an address or was emailed, and saves only if the
    lead's status and address haven't changed while it ran.
  - Addresses found before this check existed are held back (see [deployment.md](deployment.md) → "Unverified addresses") until
    someone presses **Address checked — allow sending** or edits the lead.
- **Editing and deleting leads.** Edits use the same validation and address checks as adding a lead: an
  address held by another lead, already pitched, or on the do-not-email list is refused with a link to
  whoever holds it. A lead that was already emailed keeps its address. Deleting a lead keeps its send
  history and its ledger entry, so its address is still never pitched again.
- **Manual moves never overwrite a change made meanwhile.** Every status change from a lead page is
  conditional on the status the page showed; if a reply or the stale-contacts job moved the lead in the
  meantime, the change is refused with "changed status a moment ago — reload".
- **Replies: only a confident reading acts by itself.** Every reply a person wrote gets one of three
  verdicts (`src/lib/outreach/reply-classifier.ts`, precedence documented at the top of the file):
  - **Opt-out**: an explicit request not to be emailed ("STOP", "Unsubscribe", "Remove me", "Please stop
    emailing me", "take me off your list", common Spanish, French, German, Portuguese, Italian and Dutch
    phrasings) with nothing else in the reply that sounds interested. The address goes on the do-not-email
    list at once, every send checks that list, and a lead we were working moves to Lost (Not interested in
    dataleadsell). The words that triggered it are shown on the lead page, and a wrong opt-out can be
    reversed there with **Remove from do-not-email list**.
  - **Positive**: a yes, interest, a question or a request (send details, call me, a number to call) with
    nothing that could be a stop request or a "no". It counts as a reply and moves the lead to Responded.
  - **Needs a look**: everything else — a stop request that also sounds interested ("Stop! This is exactly
    what I need. Call me."), a request that names only calls or texts, words that *may* be asking not to be
    emailed ("Kindly exclude me from future mailings", "no further contact", "Pls rmv"), a decline or
    complaint ("not interested", "wrong person", "spam"), another language, or nothing recognisable. Every
    lead with that address, in either pipeline, is flagged **Reply needs a look**; the reply doesn't count
    as a reply or as an opt-out; a Contacted lead stays off the call deck; and **nothing is emailed to the
    address** (single send, bulk send or daily run) until the operator resolves it on the lead page:
    **Mark opted out**, **Mark replied**, a status move, or **Keep as …** (which asks for confirmation). A
    reply that matched no lead holds its address the same way until it is attached, marked opted out or
    dismissed on **Replies**.
  - Only the replier's own words are read: quoted history, signatures (including a sign-off and the lines
    under it), legal and newsletter footers ("This email is confidential…", "To unsubscribe from our
    newsletter click here") and our own "Reply STOP" footer are removed first.
  - The trade-off: the rules no longer try to read every phrasing, so more replies wait for the operator.
    On the synthetic held-out sets about a third of replies need a look (see [measuring-rules.md](measuring-rules.md), "Measuring the reply and
    address rules"); in exchange none of them is suppressed or counted as a yes by mistake.
  - Automatic replies (out-of-office, autoresponders) and bounce notices are not replies; see
    [operator.md](operator.md) → "What a reply does". An opt-out is still honoured even when it comes from an autoresponder, and a message worded
    like an out-of-office that also says yes or "interested" is treated as a reply that needs a look.
- **Unsubscribe header.** Every pitch carries `Reply-To:` the sending address (the inbox the reply Worker
  reads) and `List-Unsubscribe: <mailto:…?subject=unsubscribe>` (`src/lib/send-email.ts`), so mail clients
  can show their own unsubscribe button. Pressing it emails the reply inbox with the subject
  "unsubscribe", which the reply rules read as an opt-out. One-click HTTPS unsubscribe (RFC 8058,
  `List-Unsubscribe-Post`) is not offered: it needs a public endpoint outside Vercel Deployment
  Protection (see [deployment.md](deployment.md) → "Owner-only setup").
- **Kill switch.** **Settings → Pause all outbound email** stops every send path at its next send. That
  includes a bulk send already in progress. A header pill shows while outbound email is paused.
- **Bulk sends need confirmation.** The confirmation shows how many leads will be emailed, the number of
  distinct addresses, what will be skipped and why, and a sample.
  - Nothing goes out until you press **Send to N leads**.
  - Sending runs as one server call per email, with live progress and a Stop button, so after **Stop** at
    most the email already in progress goes out.
  - The send stops by itself after three failures in a row.
- **Two tabs, one lead.** When the same lead is sent from two tabs at once, one email goes out and the
  other tab says the lead "was just emailed from another tab or send"; the lead is not flagged as a
  duplicate address.
- **Email failures are classified.** A send that definitely didn't go out, such as an unreachable server,
  releases the lead so it can be retried. The latest failure is shown in **Settings → Connections** until a
  later send succeeds. A connection that dropped mid-send is recorded as "delivery
  unknown" and is never retried automatically.
  - SMTP connections time out after 5–10 s.
  - Failures are logged with the lead id.
