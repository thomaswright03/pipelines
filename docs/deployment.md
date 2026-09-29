# Deploying and running in production

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

Six columns are at step 2: `AgentLead.lastTextedAt`, `AgentLead.nextFollowUpDate`,
`Lead.nextFollowUpDate`, `Lead.estimatedValue` (replaced by `estimatedValueCents`) and
`PipelineSchedule.hour`/`minute`. They are no longer in `prisma/schema.prisma`, so this release neither
reads nor writes them, but the database still has them because the previous deployment selects them. The
drop is ready in `prisma/pending/drop_unused_columns/migration.sql`; it first re-runs the
`estimatedValueCents` backfill, in case the previous deployment saved a value during the rollout. Once
this release is the live deployment:

```bash
mkdir prisma/migrations/<YYYYMMDDHHMMSS>_drop_unused_columns
git mv prisma/pending/drop_unused_columns/migration.sql prisma/migrations/<YYYYMMDDHHMMSS>_drop_unused_columns/
git commit -m "Drop unused columns"
PIPELINES_DIRECT_URL="<Neon unpooled URL>" npx prisma migrate deploy
```

Until then `npx prisma migrate dev` against a local database reports these columns as drift and offers to
drop them; that is expected.

The `20260925120000_outreach_safety` migration lower-cases stored addresses and fills the send ledger from
the existing send logs. That is how addresses already emailed before this release are recognised as
already pitched.

**Unverified addresses.** The `20260926090000_lead_evidence_and_reply_text` migration holds back every New,
not-yet-emailed lead that came from discovery (source other than "Manual entry") with an address, because
those addresses were found before sites had to show the lead's phone, street or city. Such leads show
"Unverified address — …" on their page and are skipped by the bulk send and the daily run. Open one, check
the website and address, then press **Address checked — allow sending**, or edit the address. Manually
entered leads are not affected.

## Reply tracking: the email Worker

Replies to the sending address reach `/api/email-inbound` from a Cloudflare Email Worker. A reference
implementation lives in `workers/email-inbound/` (`src/index.ts`, with a small MIME reader in `src/mime.ts`
and a `wrangler.toml.example` that says how to deploy it). It parses the message, sends the request below,
queues anything the app didn't record on a Cloudflare Queue and resends it with backoff for 72 hours, and
can also forward each reply to a mailbox (`FORWARD_TO`). `tests/worker-contract.test.ts` runs it against the
real route in CI: headers and `messageId` forwarded, the bypass header sent, a resend on 503 or no response,
none on 400/401, and an `ALERT:` log line after 72 hours. If production runs a different Worker, it must
follow the same contract. It must send:

```
POST /api/email-inbound
Authorization: Bearer $EMAIL_INBOUND_SECRET
x-vercel-protection-bypass: <Vercel "Protection Bypass for Automation" secret>
Content-Type: application/json

{
  "from": "Name <address@example.com>",
  "subject": "Re: …",
  "text": "plain-text body",
  "messageId": "<the email's Message-ID header>",
  "headers": { "Auto-Submitted": "auto-replied", "Precedence": "bulk", "X-Failed-Recipients": "…" }
}
```

`headers` is optional: the message's headers as `{ name: value }` (a repeated header may be a list of
values). The ones the app reads are `Auto-Submitted`, `X-Autoreply`, `X-Autorespond`, `Precedence`,
`X-Auto-Response-Suppress`, `X-Failed-Recipients` and `Content-Type`; forwarding all of them (or every
header) is simplest. Without them, automatic replies and bounces are still recognised by subject and
wording, just less reliably. The Worker should also forward delivery-failure notices (from
`MAILER-DAEMON`/`postmaster`) that reach the sending address — they are the app's only automatic bounce
signal.

`messageId` is optional but strongly recommended: it is how a re-delivered reply is recognised. Without it,
the route treats a reply with the same sender, subject and body (whitespace ignored) within 7 days as the
same reply.

**Retry contract for the Worker.** Every response body includes `"retry": true | false`.

| Status | Meaning | Worker must |
|---|---|---|
| `200` | Recorded, or already recorded (`"duplicate": true`) | Stop. |
| `400` | The body isn't `{ from, subject, text, messageId, headers }`, or `from` holds no email address (`"abc"`, `"Mail Delivery System"`). The `error` names each failing field ("subject is too long (at most 2000 characters)", "from is invalid (no email address in it…)"), and the app logs an `api.email-inbound` warning with the field names (never the content) | Not retry; log it. |
| `401` | Wrong or missing token | Not retry; fix the secret. |
| `503` (or any other 5xx, or no response) | Nothing was recorded. The body is `{ "error", "code", "retry": true }` with `code` `db_unavailable` (the database couldn't be reached) or `internal`; the cause is only in the server log | Resend the **same payload** with exponential backoff (for example 1 min, 2, 4, 8 … capped at 1 hour) for **at least 72 hours**, then alert the owner. |

Resending is always safe: a reply is recorded once no matter how many times it is delivered. Cloudflare
Email Workers don't retry `fetch` on their own, so the Worker needs a retry step, such as a Cloudflare Queue
with retries, or rejecting the message so the sending server retries it later.

## Emergency stop: `OUTBOUND_EMAIL_DISABLED`

The Settings switch (**Pause all outbound email**) needs the app and its database. For when they can't be
reached, or to stop sending from outside the app, the environment variable `OUTBOUND_EMAIL_DISABLED` stops
every send path — single send, bulk send, the daily cron run — and the mail layer refuses to hand anything
to ZeptoMail while it is set (`src/lib/outbound-switch.ts`, tested in `tests/kill-switch.test.ts`).

To stop sending:

1. Vercel → the project → **Settings → Environment Variables** → **Add**: key `OUTBOUND_EMAIL_DISABLED`,
   value `1`, environment **Production** → Save. This alone changes nothing yet: a running deployment keeps
   the environment it started with.
2. **Deployments** → the current production deployment → **⋯ → Redeploy** (keep "Use existing Build Cache"
   ticked; that makes it quicker). The redeploy usually finishes in **1–3 minutes**; the deployment's page
   shows **Ready** when it has. Until then the old deployment keeps serving — and sending.
3. Confirm it took effect: reload any page of the app. The header shows **Sending off (server)** (**Off** on
   a phone) and Settings says "Outbound email: off (server setting)". If the header still shows no such pill,
   the new deployment isn't live yet (check that the redeploy targeted Production and is **Ready**).
4. Afterwards, the next daily run of each pipeline is recorded as **Skipped** ("Outbound email is switched
   off on the server…") in the pipeline page's run history, and any send attempt answers "Outbound email is
   switched off on the server (OUTBOUND_EMAIL_DISABLED is set) — nothing was sent."

**What can still go out during those minutes.** A bulk send runs from the operator's browser one email at
a time: closing that tab stops it at once. The daily runs fire at the times in `vercel.json` (15:00, 15:33
and 16:03 UTC); if one is due within the next few minutes, also do step 5.

5. **Optional, immediate, no redeploy:** Vercel → the project → **Settings → Cron Jobs** → **Disable Cron
   Jobs**. This takes effect at once and stops the daily runs (and the stale-contacts move) until they are
   re-enabled; it doesn't stop single or bulk sends. For a stop that needs neither the app nor a redeploy,
   delete (or regenerate) the SMTP password of the sending Mail Agent in ZeptoMail — every send then fails
   with a login error and nothing is delivered, and a bulk send stops by itself after three failures in a
   row. Undo both afterwards (a new SMTP password also has to go into `ZEPTOMAIL_SMTP_PASSWORD`).

To send again, delete the variable (or set it to `0`) and redeploy the same way; the header pill disappears
once the new deployment is live. The Settings switch can't override the variable.

## Settings → Connections

What each row checks, and which setting is behind a problem it reports. The screen itself is written for
the operator and names no settings; this table is for the developer they're told to contact.

| Row | "Working" only when | On-screen problem → what to fix |
| --- | --- | --- |
| Sending email | The latest send succeeded, or the latest **Test connection** (SMTP connect, STARTTLS and login; nothing is sent) passed | "turned down our login" → `ZEPTOMAIL_SMTP_PASSWORD`; "isn't set up on the server" → the password is missing; "still in test mode" → `EMAIL_TRANSPORT` isn't `zeptomail`; "no server address" → `SMTP_HOST` |
| Receiving replies | An inbound message of any kind arrived in the last 7 days | "Reply forwarding isn't switched on" → `EMAIL_INBOUND_SECRET`; "Not confirmed yet" / "replies seem to have stopped" → the Cloudflare Email Worker and Vercel's Protection Bypass for Automation (see "Reply tracking: the email Worker" above) |
| Daily run, stale contacts | The last run succeeded and was less than 26 hours ago | "password isn't set on the server" → `CRON_SECRET`; "has stopped running" → the Vercel project's Cron Jobs tab |
| Yelp search | The latest Yelp request (a search, a daily run or **Test connection**, which asks for one business) answered | "Yelp isn't set up" → `YELP_API_KEY` missing; "rejected our access key" → the key is wrong or revoked |

## Owner-only setup

These need the Vercel, GitHub or Cloudflare dashboards, or a business decision. The code is ready for each.

1. **Apply the migrations** in this release to production before deploying it — including
   `20261002090000_inbound_verdict` (additive: each reply's verdict, backfilled from the stored fields, and
   the rules version on each correction), `20261001090000_send_log_template_version` (additive: the subject
   and template version of each send),
   `20260927090000_history_lookup_retries_reply_review`, `20260927100000_estimated_value_cents`,
   `20260928090000_inbound_kind`, `20260928100000_send_failure_status`, `20260929090000_rules_version`,
   `20260929100000_connection_checks`, `20260930090000_send_attempts`, `20260930100000_send_log_lead_index`
   (all additive) and `20260929110000_lead_status_check`. See the top of this page.
   The status check is added `NOT VALID`, so it can't fail on existing rows. Afterwards, check for rows it
   would reject and fix them (for example with the lead page's status control), then validate it:

   ```sql
   SELECT id, status FROM "Lead" WHERE status NOT IN ('new','contacted','responded','appointment_set','working_for','paying_client','cold_call_list','contactless_list','lost');
   SELECT id, status FROM "AgentLead" WHERE status NOT IN ('new','contacted','responded','subscribed','not_interested','cold_call_list','contactless_list','lost');
   ALTER TABLE "Lead" VALIDATE CONSTRAINT "Lead_status_check";
   ALTER TABLE "AgentLead" VALIDATE CONSTRAINT "AgentLead_status_check";
   ```
2. **Make reply tracking reachable.**
   - In Vercel, open Project Settings → Deployment Protection and enable **Protection Bypass for
     Automation**.
   - Set the Worker to send the generated secret as the `x-vercel-protection-bypass` header, alongside its
     Bearer token.
   - Until then, Vercel's SSO wall answers the Worker with its own 401, and replies and opt-outs must be
     marked by hand.
   - Deploy `workers/email-inbound` (steps at the top of its `wrangler.toml.example`) in place of the current
     Worker, or bring the current one up to the same contract: send `messageId` and follow the retry contract
     in "Reply tracking: the email Worker" above (resend any 5xx or failed request with backoff for at least 72 hours). Route the
     outreach sender addresses to it in Cloudflare → Email Routing, and set up a notification on the Worker's
     `ALERT:` log lines.
   - Update the Worker to forward the message's headers as `headers` (at least `Auto-Submitted`,
     `X-Autoreply`, `X-Autorespond`, `Precedence`, `X-Auto-Response-Suppress`, `X-Failed-Recipients`,
     `Content-Type`) and to forward delivery-failure notices too, so automatic replies and bounces are
     recognised reliably.
   - Until a reply arrives, **Settings → Connections** shows "Receiving replies: Not confirmed yet"; once one
     arrives it shows "Working" with its time.
3. **Set `EMAIL_TRANSPORT=zeptomail` explicitly** on the Production environment in Vercel. Off Vercel,
   the transport defaults to the local outbox. Setting the value explicitly means production doesn't
   depend on Vercel's system variables being exposed.
4. **Require CI before merging.** In GitHub → Settings → Branches (or Rules → Rulesets), protect `main` and
   make the `CI / build-lint-test` check required, so a pull request with a failing test, lint, format or
   build can't be merged. The repository can't show whether this is on; confirm it here once done.
5. **Press Test connection** for email and Yelp in **Settings → Connections** after deploying, so each shows
   "Working" from a real login/search rather than "Not confirmed yet".
6. **Decide cross-pipeline repeats.** Decide whether an address pitched by one pipeline may also get the
   other pipeline's pitch. Leave it off (the default) or turn it on in Settings.
7. **Lawful basis for the outreach.** This is a legal review, not a code change. See README → "Known limitations".
8. **Review the held-back leads** after applying `20260926090000_lead_evidence_and_reply_text`: filter each
   pipeline's list to New and check the flagged rows (see "Unverified addresses" above).
9. **Decide the interface language.** Still open. The developer's recommendation (2026-09-26) is
   English-only for this single-operator, US-only tool. Confirm it by replacing the first bullet of
   README → "Known limitations" with your decision and its date, or commission Spanish/French (every
   string into a translation layer with complete catalogues, a persistent switcher and localised dates
   and numbers).
10. **Grow the evaluation sets with real, anonymised replies and agent addresses** (see [measuring-rules.md](measuring-rules.md), "Measuring the
   reply and address rules"). Only the owner can read the production replies.
11. **Approve the Cold Outreach subject line.** The subject (`src/lib/vault-email-template.ts`) is the
   owner's own wording and was left as is; a reviewer flagged "I probably shouldn't have sent this 😂" as not
   describing the offer. Every send now records its subject and template version, and each pipeline's
   Stats page shows the reply rate per version, so a new subject can be compared with the current one.
12. **Drop the unused columns** once this release is live: see "Changing the database schema" above
    (`prisma/pending/drop_unused_columns`).
13. **Decide on one-click unsubscribe.** Every pitch carries `List-Unsubscribe: <mailto:…?subject=unsubscribe>`
    and `Reply-To`, which mail clients can use today. Gmail and Yahoo's bulk-sender rules also expect the
    HTTPS one-click form (RFC 8058, `List-Unsubscribe-Post: List-Unsubscribe=One-Click`), which needs a
    public route that Vercel Deployment Protection doesn't wall off (a separate unprotected project or a
    Cloudflare Worker that records the opt-out). That is a hosting and cost decision; the app's opt-out
    handling (`suppressEmail`) is ready to be called from it.
14. **Look at flagged replies every day.** A reply the rules can't read with confidence holds every email to
    its address until someone resolves it on the lead page (or on Replies for an unknown address). On the
    synthetic evaluation sets that is about a quarter of replies (26%, down from 40% now that plain no's and
    thank-you-only replies are handled on their own); the dashboard and Replies show the count.
15. **Know the emergency stop.** Add `OUTBOUND_EMAIL_DISABLED` only when you need it (steps in "Emergency
    stop" above); it is not set in normal operation. Consider saving the steps somewhere you can reach
    without the app.
