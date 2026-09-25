# Pipelines

Thomas Wright's internal dashboard for Wright AI Solutions' email outreach pipelines. It is **not** a
multi-tenant product: there is one operator, and access is gated by Vercel Deployment Protection (SSO), not
an in-app login.

Two pipelines live here:

- **dataleadsell.com** (`/dataleadsell`) finds real estate agents in Maricopa (AZ), Salt Lake and Utah (UT)
  counties, via Yelp and Arizona's ADRE license roster. It finds each agent's own email address and pitches a
  Probate Property Leads subscription.
- **Cold Outreach** (`/vault-pipeline`) is Wright AI Solutions' own client-acquisition pipeline. It finds
  local businesses via Yelp, emails each one a single pitch, and runs automatically once a day.

Each pipeline has a lead list, a **call deck** for phone follow-up, and **Stats**. Every lead page has
**Edit details** and **Delete lead…**. **Replies** (`/replies`) shows whether replies are arriving and lists
replies from addresses that match no lead, so they can be attached to the right one. **Settings**
(`/settings`) holds the switches that apply to both pipelines and the searchable do-not-email list.

The interface is English-only by decision: the one operator and every recipient are in the US. All strings
are hard-coded in the components; there is no translation layer to maintain.

A third dashboard card, **AI Lead Responder**, links out to a separate Vercel project. It is not code in
this repo.

## How outreach is kept safe

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
- **Only addresses tied to the lead.** Discovery guesses a website from the lead's name (Yelp and ADRE
  don't give one). An address found on a guessed site is saved only if that site also shows the lead's
  phone number, street address or city from Yelp/ADRE (`src/lib/outreach/site-evidence.ts`); otherwise a
  business or person with a similar name could get the lead's one pitch. The evidence is saved on the lead
  and shown on its page as **Why this address**. An uncorroborated find is not saved (a manual **Find
  email** reports it, so the operator can check it and enter it by hand).
  - Addresses found before this check existed are held back (see "Deploying" → unverified addresses) until
    someone presses **Address checked — allow sending** or edits the lead.
- **Editing and deleting leads.** Edits use the same validation and address checks as adding a lead: an
  address held by another lead, already pitched, or on the do-not-email list is refused with a link to
  whoever holds it. A lead that was already emailed keeps its address. Deleting a lead keeps its send
  history and its ledger entry, so its address is still never pitched again.
- **Manual moves never overwrite a change made meanwhile.** Every status change from a lead page is
  conditional on the status the page showed; if a reply or the stale-contacts job moved the lead in the
  meantime, the change is refused with "changed status a moment ago — reload".
- **Opt-outs.** A reply that asks to stop puts the address on the do-not-email list, and every send checks
  that list. The reply check reads only the new text of the reply: quoted history and signatures are
  ignored, so an interested reply that quotes our "Reply STOP" footer is not an opt-out.
  - The words that triggered an opt-out are stored and shown on the lead page.
  - A wrong opt-out can be reversed there with **Remove from do-not-email list**.
- **Kill switch.** **Settings → Pause all outbound email** stops every send path at its next send. That
  includes a bulk send already in progress. A header pill shows while outbound email is paused.
- **Bulk sends need confirmation.** The confirmation shows how many leads will be emailed, the number of
  distinct addresses, what will be skipped and why, and a sample.
  - Nothing goes out until you press **Send to N leads**.
  - Sending runs as one server call per email, with live progress and a Stop button, so after **Stop** at
    most the email already in progress goes out.
  - The send stops by itself after three failures in a row.
- **Email failures are classified.** A send that definitely didn't go out, such as an unreachable server,
  releases the lead so it can be retried. A connection that dropped mid-send is recorded as "delivery
  unknown" and is never retried automatically.
  - SMTP connections time out after 5–10 s.
  - Failures are logged with the lead id.

## Running it locally

You need Node 22 and PostgreSQL 16. Nothing in local development touches production data or sends real
email.

1. Create local databases. Run these as a Postgres superuser; on Linux that is usually `sudo -u postgres`.
   The role and password below match `.env.example`, so change both together if you use different ones.

   ```bash
   createuser -s ci && psql -c "ALTER ROLE ci PASSWORD 'ci'"
   createdb -O ci pipelines_dev
   createdb -O ci pipelines_test
   ```

2. Install and configure.

   ```bash
   npm install
   cp .env.example .env
   ```

   The defaults are safe: a local database and `EMAIL_TRANSPORT=outbox`.

3. Create the schema and start the app.

   ```bash
   npx prisma migrate deploy
   npm run dev
   ```

   The app runs at [http://localhost:4000](http://localhost:4000).

**Where email goes locally.** With `EMAIL_TRANSPORT=outbox` (the default off Vercel), every "sent" email is
written to `.outbox/*.eml` and nothing is delivered. To read the mail in a browser instead, run a local mail
catcher such as [Mailpit](https://mailpit.axllent.org) and use these settings:

```bash
EMAIL_TRANSPORT=smtp
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
```

Then open http://localhost:8025. While mail goes to a catcher on this machine, the header shows **Mail captured
locally (127.0.0.1:1025)**; with the outbox it shows **Test mode — emails are saved, not delivered**. If
`SMTP_HOST` points anywhere other than this machine, the header shows **Mail sent via host:port** in amber
instead, because that server may deliver to real people. Never put the production ZeptoMail password in a
local `.env`.

**Discovery locally.** The search buttons call Yelp, which needs a real `YELP_API_KEY` and uses up real
quota. Leave the key empty to work on everything else. To get leads without Yelp, use **+ Add lead by
hand**.

The app checks its environment at startup (`src/instrumentation.ts`) and refuses to start, naming whatever is
missing.

## Tests

```bash
npm test               # vitest run
npm run test:watch
npm run test:coverage  # the same, plus a coverage report for src/
npm run build && npm run test:e2e   # browser smoke tests (Playwright; first time: npx playwright install chromium)
```

The suite runs against a real, disposable Postgres. It uses `TEST_DATABASE_URL` and defaults to
`postgresql://ci:ci@localhost:5432/pipelines_test`.

- `tests/global-setup.ts` applies `prisma/migrations` to that database, and every test starts from empty
  tables.
- The setup refuses any database host other than `localhost`, `127.0.0.1` or `postgres`.

External services are always fakes:

- **Email** goes to a capturing transport, which can be told to fail like a real SMTP server.
- **`fetch`** is stubbed per test with fixture pages and Yelp responses. Any call a test didn't stub fails
  the test.

What's covered, by file:

| File | Covers |
| --- | --- |
| `tests/send.test.ts` | One pitch per address, overlapping sends, crash-after-claim, pause, SMTP failure handling |
| `tests/inbound.test.ts`, `tests/reply-classifier.test.ts` | Reply and opt-out classification |
| `tests/discovery.test.ts`, `tests/email-finder.test.ts` | Discovery and email lookup |
| `tests/adre.test.ts` | Resumable ADRE import |
| `tests/cron.test.ts` | The cron routes |
| `tests/daily-run.test.ts` | What "businesses to check per run" yields; leftovers emailed by the next run; the 60 s budget (fake clock); skipped leads don't fail a run |
| `tests/replies.test.ts` | Replies after the stale-contacts move, Lost-lead review flag, Mark replied, duplicate delivery, database outage and retry, stale-contacts race |
| `tests/stats.test.ts` | Stats, including reply rate and Arizona days |
| `tests/lead-actions.test.ts` | Stage rules, moves racing a reply, the Settings do-not-email list |
| `tests/site-evidence.test.ts` | Guessed sites must show the lead's phone/street/city; duplicate detection by name plus phone/address/city |
| `tests/lead-edit.test.ts` | Editing (address rules, links to the holder, pitched leads keep their address), deleting, unverified addresses |
| `tests/unmatched-replies.test.ts` | Replies from unknown addresses: listed, attached to a lead, dismissed; the "no replies lately" warning |
| `tests/greeting.test.ts` | dataleadsell greets agents by first name; the preview is what's sent |
| `tests/e2e.test.ts` | One run per pipeline through the same server actions the pages use |

**Browser smoke tests** (`e2e/smoke.spec.ts`, Playwright) run against a production build served on port
4100. They cover adding a lead with an invalid email, a single send, a bulk send stopped midway (at most
two emails after Stop), pause/resume, Enter confirming a send but cancelling a destructive action,
editing a lead (including the link to the lead holding an address), deleting a lead, attaching an
unmatched reply, stale messages clearing, per-page tab titles, and the lead list at 375–2560 px. The server uses
`EMAIL_TRANSPORT=outbox` (mail is written to `test-results/e2e-outbox`, never delivered) and its own
database, `E2E_DATABASE_URL` (default `postgresql://ci:ci@localhost:5432/pipelines_e2e`), which
`e2e/prepare-db.mjs` creates and migrates. It refuses non-local hosts.

## CI

`.github/workflows/ci.yml` runs on every push and pull request. It uses a throwaway `postgres:16` service
container and runs `npm ci`, `npm run build` (including the type check), `npm run lint`, the test suite
with coverage (the summary appears on the run page), and the browser smoke tests. CI has no secrets and
reaches no external service other than downloading Chromium.

## Daily automation

`vercel.json` defines two Vercel Cron jobs. Both routes need `Authorization: Bearer $CRON_SECRET`, which
Vercel sends automatically when `CRON_SECRET` is set.

| Route | Schedule (UTC) | Arizona time | What it does |
| --- | --- | --- | --- |
| `/api/cron/vault-daily` | `33 15 * * *` | 8:33 AM | Cold Outreach: searches one new city, saves businesses with a findable email, pitches them and any leads earlier daily runs found but didn't email |
| `/api/cron/stale-contacts` | `0 13 * * *` | 6:00 AM | Both pipelines: contacted leads with no reply after 7 days move to the call deck (or the contactless list if there's no phone) |

- **Settings.** The Cold Outreach page controls whether the daily run happens and how many **businesses it checks** for an address (1–50; one Yelp search returns at most 50). That is not the number emailed: typically only 15–25% of businesses yield a usable address, and discovery stops after 25 s. The panel shows the last run's actual numbers (businesses checked, addresses found, leads emailed), which are stored on the `PipelineRun` row. Changes apply to the next run.
- **Run time.** The time is fixed in `vercel.json`, so changing it needs a code change and a redeploy.
- **Run log.** Every run is recorded in `PipelineRun`, whether it succeeded, partly failed, failed or was skipped, along with the reasons. The last five runs appear on the Cold Outreach page.
  - The page warns when the last run is more than 26 hours old.
  - Both routes return JSON: `{ status, summary, errors }`. A failed run returns HTTP 500.
  - Only real send failures (the email service refused or dropped the send) make a run **partial** or
    **failed**. Leads the send rules skipped (address already pitched, opted out) are listed as skipped
    and the run still **succeeded**.
  - A run still marked running two minutes after it started was cut off before it could record its
    outcome, and shows as **Interrupted**.

Each run is time-budgeted to finish and record its outcome inside Vercel's 60-second function limit. Each
step starts only if its worst case fits: discovery (including the Yelp call) ends by 25 s — no lookup
starts with under 2 s left, and one in progress is cut off at 25 s — and a send starts only if its worst
case (20 s of SMTP timeouts) still ends by 55 s. Leads a daily run found but didn't email (out of
time, or the email service was unreachable and nothing was sent) stay New and are emailed by the next daily
run, oldest first, under all the usual send rules. Both pipeline pages show "N leads found but not yet
emailed" next to the bulk-send button.

## Reply tracking

Replies to the sending address reach `/api/email-inbound` from a Cloudflare Email Worker. The Worker is not in
this repo. It must send:

```
POST /api/email-inbound
Authorization: Bearer $EMAIL_INBOUND_SECRET
x-vercel-protection-bypass: <Vercel "Protection Bypass for Automation" secret>
Content-Type: application/json

{
  "from": "Name <address@example.com>",
  "subject": "Re: …",
  "text": "plain-text body",
  "messageId": "<the email's Message-ID header>"
}
```

`messageId` is optional but strongly recommended: it is how a re-delivered reply is recognised. Without it,
the route treats a reply with the same sender, subject and body (whitespace ignored) within 7 days as the
same reply.

What a reply does, in both pipelines (`src/lib/outreach/inbound.ts`):

- A lead that was emailed and is **Contacted**, **Cold call list** or **No phone number** moves to
  **Responded** and its reply time is set. That takes it off the call deck and counts it in the Stats
  page's reply rate, however late the reply arrives.
- A **Lost** or **Not interested** lead keeps its status, gets a reply time, and is flagged **Replied — needs
  review** in the lead list and on the lead page, until someone moves it or presses "Keep as …".
- A genuine opt-out goes on the do-not-email list with its evidence, whatever the lead's status, and a lead
  that was being worked (Contacted, Responded, on the call deck) moves to Lost (Not interested in
  dataleadsell). Customers keep their status.
- The reply's new text is logged on the lead either way.
- A reply from an address that is on no lead (an assistant, a personal inbox, a forward) is kept with its
  text and listed on **Replies**, with a count next to "Replies" in the header. **Attach** records it on the
  lead you pick exactly as if it had come from the lead's own address (for an opt-out, the lead's address
  also goes on the do-not-email list); **Dismiss** removes it from the list.
- **Is it working?** Both pipeline pages and Replies show when the last reply arrived, and warn when emails
  went out 2–7 days ago but no reply of any kind has been recorded for a week — usually a sign the Worker
  isn't reaching the app.

The reply, its effects and a record of it are written in one database transaction, so a failure leaves
nothing half-recorded.

**Retry contract for the Worker.** Every response body includes `"retry": true | false`.

| Status | Meaning | Worker must |
|---|---|---|
| `200` | Recorded, or already recorded (`"duplicate": true`) | Stop. |
| `400` | The body isn't `{ from, subject, text, messageId }` | Not retry; log it. |
| `401` | Wrong or missing token | Not retry; fix the secret. |
| `503` (or any other 5xx, or no response) | Nothing was recorded, e.g. the database was unreachable | Resend the **same payload** with exponential backoff (for example 1 min, 2, 4, 8 … capped at 1 hour) for **at least 72 hours**, then alert the owner. |

Resending is always safe: a reply is recorded once no matter how many times it is delivered. Cloudflare
Email Workers don't retry `fetch` on their own, so the Worker needs a retry step, such as a Cloudflare Queue
with retries, or rejecting the message so the sending server retries it later.

Replies that don't reach the route can be recorded by hand from the lead page with **Mark replied** (offered
for Contacted, Cold call list and No phone number leads that were emailed), **Mark bounced** or **Mark opted
out**.

## Deploying

Production runs on Vercel, with Neon Postgres and ZeptoMail. Environment variables are set in the Vercel
project (Settings → Environment Variables). See `.env.example` for what each one does.

**Order matters when a release includes new files in `prisma/migrations`.** Apply them to production
before the new code goes live, because the app never migrates at boot:

```bash
PIPELINES_DIRECT_URL="<Neon unpooled URL>" npx prisma migrate deploy
```

Then deploy. Migrations in this repo are **additive**: new tables, columns and indexes, plus data backfills.
That means the previous deployment keeps working on the migrated database, and rolling back is only a
matter of code. To roll back, use **Instant Rollback** to the previous deployment in the Vercel dashboard (or
`vercel rollback`).

### Changing the database schema

Use expand-then-contract:

1. Add new things in one release.
2. Stop using old columns.
3. Drop the old columns in a later release, once no live deployment reads them.

A few columns are marked `unused` in `prisma/schema.prisma` and are waiting for that last step:
`AgentLead.lastTextedAt`, `AgentLead.nextFollowUpDate`, `Lead.nextFollowUpDate`, and
`PipelineSchedule.hour`/`minute`. Once this release is the live one, generate the drop with the command
below, commit it, and apply it as above.

```bash
npx prisma migrate dev --name drop_unused_columns
```

The `20260925120000_outreach_safety` migration lower-cases stored addresses and fills the send ledger from
the existing send logs. That is how addresses already emailed before this release are recognised as
already pitched.

**Unverified addresses.** The `20260926090000_lead_evidence_and_reply_text` migration holds back every New,
not-yet-emailed lead that came from discovery (source other than "Manual entry") with an address, because
those addresses were found before sites had to show the lead's phone, street or city. Such leads show
"Unverified address — …" on their page and are skipped by the bulk send and the daily run. Open one, check
the website and address, then press **Address checked — allow sending**, or edit the address. Manually
entered leads are not affected.

## Owner-only setup

These need the Vercel, GitHub or Cloudflare dashboards, or a business decision. The code is ready for each.

1. **Apply the migrations** in this release to production before deploying it. See "Deploying".
2. **Make reply tracking reachable.**
   - In Vercel, open Project Settings → Deployment Protection and enable **Protection Bypass for
     Automation**.
   - Set the Worker to send the generated secret as the `x-vercel-protection-bypass` header, alongside its
     Bearer token.
   - Until then, Vercel's SSO wall answers the Worker with its own 401, and replies and opt-outs must be
     marked by hand.
   - Update the Worker to send `messageId` and to follow the retry contract in "Reply tracking" (resend
     any 5xx or failed request with backoff for at least 72 hours).
3. **Set `EMAIL_TRANSPORT=zeptomail` explicitly** on the Production environment in Vercel. Off Vercel,
   the transport defaults to the local outbox. Setting the value explicitly means production doesn't
   depend on Vercel's system variables being exposed.
4. **Require CI before merging.** In GitHub, add a branch protection rule on `main` that requires the
   `CI / build-lint-test` check.
5. **Decide cross-pipeline repeats.** Decide whether an address pitched by one pipeline may also get the
   other pipeline's pitch. Leave it off (the default) or turn it on in Settings.
6. **Lawful basis for the outreach.** This is a legal review, not a code change. See "Known limitations".
7. **Review the held-back leads** after applying `20260926090000_lead_evidence_and_reply_text`: filter each
   pipeline's list to New and check the flagged rows (see "Deploying" → Unverified addresses).

## Known limitations

- **Email finding is a heuristic.** Neither Yelp nor ADRE gives a business's website, so
  `src/lib/website-finder.ts` guesses a few plausible domains from the name and checks them directly. It uses
  no search engine, because those block automated queries or charge for them. A guessed site is only used
  when it shows the lead's phone, street or city, which trades some yield for not pitching the wrong
  business. Expect well under a quarter of results to yield a usable address.
  - For agents, an address on a brokerage's site is used only if it is recognisably the agent's own, never
    a shared inbox like `info@` or `frontdesk@`.
- **No bounce webhook.** ZeptoMail's SMTP relay gives no message id that a bounce notification could be
  matched against, so bounces are marked by hand with **Mark bounced**.
- **Where the outreach data comes from is a business/legal question, not a code one.** Both pipelines email
  people found through Yelp's API and Arizona's public ADRE roster, without prior opt-in.
  - What CAN-SPAM explicitly requires is handled: every email includes the mailing address and a working
    opt-out, and opt-outs are enforced before every send in both pipelines.
  - Whether sourcing addresses this way has a sound lawful basis has not been reviewed. That is flagged
    for the owner.
- `docs/archive/LEAD_GEN_PIPELINE_SPEC.md` is the historical spec the Cold Outreach pipeline was first built from. It
  does not describe the current system.
