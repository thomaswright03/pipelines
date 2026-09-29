# Pipelines

[![CI](https://github.com/thomaswright03/pipelines/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/thomaswright03/pipelines/actions/workflows/ci.yml)

Thomas Wright's internal dashboard for Wright AI Solutions' email outreach. One operator, no in-app login:
access is gated by Vercel Deployment Protection (SSO). Two pipelines live here:

- **dataleadsell.com** (`/dataleadsell`) finds real estate agents in Maricopa (AZ), Salt Lake and Utah (UT)
  counties via Yelp and Arizona's ADRE license roster, finds each agent's own email address and pitches a
  Probate Property Leads subscription.
- **Cold Outreach** (`/vault-pipeline`) finds local businesses via Yelp and emails each one a single pitch,
  automatically once a day.

Each pipeline has a lead list, a call deck for phone follow-up and Stats. **Replies** (`/replies`) tracks
inbound mail, **Settings** holds the kill switch, connections and the do-not-email list, and **Operator
guide** (`/help`) is the runbook, with a glossary. To stop all outbound email without the app, set
`OUTBOUND_EMAIL_DISABLED=1` in Vercel and redeploy; it applies when the redeploy is live, usually within 1–3
minutes ([docs/deployment.md](docs/deployment.md) → "Emergency stop" has the steps and how to confirm it).

| Document | For | What's in it |
| --- | --- | --- |
| [docs/operator.md](docs/operator.md) | The operator and support | What each screen shows, what a reply does, the daily run |
| [docs/outreach-safety.md](docs/outreach-safety.md) | Developers | Every rule that keeps a send safe (one pitch per address, opt-outs, replies that need a look, kill switch) |
| [docs/deployment.md](docs/deployment.md) | Developer and owner | Deploying, schema changes, the reply Worker contract, Connections, **owner-only setup** |
| [docs/testing.md](docs/testing.md) | Developers | The test suites, coverage floors, browser tests and CI |
| [docs/measuring-rules.md](docs/measuring-rules.md) | Developers | How the reply and address heuristics are scored, and how to add real replies |

## Architecture

```
Browser (operator) ──► Next.js pages (src/app) ──► server actions (src/lib/actions)
                                  │                          │
Vercel Cron ──► /api/cron/*  ─────┤                          ▼
Cloudflare Email Worker ──► /api/email-inbound ──►  src/lib/outreach  ──► Postgres (Prisma)
                                                        │      │
                                                        │      └──► ZeptoMail SMTP (nodemailer)
                                                        └──► Yelp API, ADRE roster, business websites
```

- **Request flow.** Pages are server components that read through `src/lib` and Prisma. Every change the
  operator makes is a server action in `src/lib/actions/` (validation, then one call into
  `src/lib/outreach/`). The rules live once in `src/lib/outreach/`: `send.ts` (every email goes through
  it), `inbound.ts` + `reply-classifier.ts` + `auto-mail.ts` (replies, opt-outs, bounces),
  `discovery.ts` + `site-evidence.ts` + `email-policy.ts` (finding addresses), `lead-actions.ts` and
  `lead-edit.ts` (status moves, edits), `stale-contacts.ts` (the 7-day move), `pipelines.ts` (the two
  pipelines' tables behind one interface).
- **Routes that aren't pages.** `/api/cron/vault-daily`, `/api/cron/garbage-ai-daily` and `/api/cron/stale-contacts` (Vercel Cron,
  `vercel.json`, Bearer `CRON_SECRET`); `/api/email-inbound` (the Cloudflare Email Worker in
  `workers/email-inbound/`, Bearer `EMAIL_INBOUND_SECRET`); `/api/health`; `/api/contact-card/…` (vCard).
  `src/proxy.ts` answers page requests with 503 while the database is down; `src/instrumentation.ts`
  checks the environment at startup.
- **Data stores.** One Postgres database (Neon in production), schema in `prisma/schema.prisma`,
  migrations in `prisma/migrations/` (additive; see docs/deployment.md). Main tables: `Lead` and
  `AgentLead` (one per pipeline) with their `…Activity` history and `…EmailSendLog` sends;
  `OutreachRecipient` (the one-pitch-per-address ledger); `SuppressedEmail` (do-not-email list);
  `InboundReply` (every inbound message and the rules' verdict); `OutreachCorrection` (operator
  corrections); `PipelineRun` (cron runs); `AppSettings`, `PipelineSchedule`, `PipelineMeta`; ADRE and
  city-rotation tables. Nothing else is stored: no cache, queue or file store (the Worker's retry queue
  lives in Cloudflare).
- **External services.** ZeptoMail (SMTP, sending), Cloudflare Email Routing + Worker (receiving),
  Yelp Fusion (discovery), ADRE (public roster download), the businesses' own websites (address lookup),
  Vercel (hosting, cron, SSO). Local development and CI use none of them: mail goes to an outbox or a local
  catcher, and `fetch` is stubbed in tests.
- **UI.** React 19 server components with small client components in `src/components/`, Tailwind v4.
  English-only, with no translation layer (see "Known limitations").

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

2. Install and configure: `npm install`, then `cp .env.example .env`. The defaults are safe: a local
   database and `EMAIL_TRANSPORT=outbox`.

3. Create the schema and start the app: `npx prisma migrate deploy`, then `npm run dev`. The app runs at
   [http://localhost:4000](http://localhost:4000).

**Where email goes locally.** With `EMAIL_TRANSPORT=outbox` (the default off Vercel), every "sent" email is
written to `.outbox/*.eml` and nothing is delivered. To read the mail in a browser instead, run a local mail
catcher such as [Mailpit](https://mailpit.axllent.org) with `EMAIL_TRANSPORT=smtp`, `SMTP_HOST=127.0.0.1`,
`SMTP_PORT=1025`, and open http://localhost:8025. The header says where mail goes: **Test mode — emails are
saved, not delivered**, **Mail captured locally (127.0.0.1:1025)**, or, in amber, **Mail sent via
host:port** when `SMTP_HOST` is another machine that may deliver to real people. Never put the production
ZeptoMail password in a local `.env`.

**Discovery locally.** The search buttons call Yelp, which needs a real `YELP_API_KEY` and uses up real
quota. Leave the key empty to work on everything else, and use **+ Add lead by hand**.

**When the database is down,** every page shows "Can't reach the database right now" and a **Try again**
button; page requests get HTTP 503 (`src/proxy.ts`, which reuses its probe for 5 s). `GET /api/health`
answers `{"database":"ok"}` (200) or `{"database":"unreachable"}` (503) for an uptime monitor.

## Tests and CI

```bash
npm test               # vitest against a disposable local Postgres (TEST_DATABASE_URL)
npm run test:coverage  # the same, with coverage floors
npm run build && npm run test:e2e   # Playwright browser tests against the production build
npm run lint && npm run format:check
```

CI (`.github/workflows/ci.yml`, badge above) runs all of these on every push and pull request, with no
secrets and no external services. Making its `CI / build-lint-test` check required before merging to `main`
is a GitHub setting only the owner can turn on (docs/deployment.md → "Owner-only setup"). Details, the per-file coverage table and the browser tests are in
[docs/testing.md](docs/testing.md); how the reply and address heuristics are scored is in
[docs/measuring-rules.md](docs/measuring-rules.md).

## Known limitations

- **The interface language is not decided.** The interface is English-only: the one operator and every
  recipient are in the US, so strings are hard-coded in the components. That is the developer's
  recommendation (recorded 2026-09-26); the owner has not confirmed it — see docs/deployment.md →
  "Owner-only setup". Spanish/French would mean moving every string into a translation layer with full
  catalogues, a persistent switcher and localised dates and numbers. Replies are separate: common Spanish,
  French, German, Portuguese, Italian and Dutch opt-outs are honoured, and any other reply in another
  language needs a look.
- **Replies the rules can't read with confidence wait for the operator.** About a quarter (26%) of the
  synthetic held-out replies land on "needs a look", and nothing is emailed to such an address until the
  operator resolves it (docs/outreach-safety.md). A plain "no thanks" closes the lead and a "Thanks" /
  "Got it" changes nothing, without the operator; both also stop further email to the address, and neither
  is treated as an opt-out. The Replies page and the lead list show how many are waiting.
- **Email finding is a heuristic.** Neither Yelp nor ADRE gives a business's website, so
  `src/lib/website-finder.ts` guesses a few plausible domains from the name and checks them directly (no
  search engine: those block automated queries or charge for them). A guessed site is only used when it
  shows the lead's phone or street, or its city plus the lead's name in the page title, which trades yield
  for not pitching the wrong business. Expect well under a quarter of results to yield a usable address.
  For agents, an address on a brokerage's site is used only if it names the agent.
- **No bounce webhook.** ZeptoMail's SMTP relay gives no message id a bounce notification could be matched
  against. Bounce notices that reach the reply inbox are recorded automatically; any other bounce is marked
  by hand with **Mark bounced**.
- **Automatic-reply detection is a heuristic.** Headers are reliable; without them, subject and wording
  decide. A reply worded like an out-of-office that also says yes or "interested" needs a look rather than
  being filed as automatic; any other person's reply read as automatic is still in the lead's History, and
  **Mark replied** records it.
- **One-click unsubscribe (RFC 8058) is not offered.** Every pitch has a `mailto:` `List-Unsubscribe`
  header; the HTTPS one-click form needs a public endpoint outside Vercel Deployment Protection (an owner
  decision, docs/deployment.md).
- **Where the outreach data comes from is a business/legal question, not a code one.** Both pipelines email
  people found through Yelp's API and Arizona's public ADRE roster, without prior opt-in. What CAN-SPAM
  explicitly requires is handled (a mailing address and a working opt-out in every email, opt-outs enforced
  before every send); whether sourcing addresses this way has a sound lawful basis has not been reviewed.
- `docs/archive/LEAD_GEN_PIPELINE_SPEC.md` is the historical spec the Cold Outreach pipeline was first built
  from. It does not describe the current system.
