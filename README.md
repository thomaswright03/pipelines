# Pipelines

[![CI](https://github.com/thomaswright03/pipelines/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/thomaswright03/pipelines/actions/workflows/ci.yml)

Thomas Wright's internal dashboard for Wright AI Solutions' email outreach. One operator, no in-app login:
access is gated by Vercel Deployment Protection (SSO). Three pipelines live here:

- **dataleadsell.com** (`/dataleadsell`) finds real estate agents in Maricopa (AZ), Salt Lake and Utah (UT)
  counties via a business list (Foursquare) and Arizona's ADRE license roster, finds each agent's own email address and pitches a
  Probate Property Leads subscription.
- **Cold Outreach** (`/vault-pipeline`) finds local businesses via the business list and emails each one a single pitch,
  automatically, up to its "emails to send per day" number.
- **Garbage AI** (`/garbage-ai`) finds trash, recycling and dumpster-rental haulers via the business list, a new US city
  each run, and pitches them a demo of an AI that texts back their online leads. It never emails current
  clients, national haulers, city/county departments or any hauler in Mountain High Disposal's Colorado
  service area (`src/lib/garbage-ai-targeting.ts`).
- **Room Designer 3D** (`/room-designer`) finds independent bathroom remodelers via the business list, new US cities each
  weekday, and pitches them Room Designer 3D (a 3D bathroom designer and estimator) with a free week. It never
  emails Eddys Remodeling, national franchises, big-box installers, plumbers, supply houses or showrooms
  (`src/lib/room-designer-targeting.ts`). Sending is held in code until Thomas says go
  (`ROOM_DESIGNER_SENDING_HELD` in `src/lib/room-designer-config.ts`).

All four share one set of send rules: one pitch per address across pipelines, the do-not-email list,
reply holds and both kill switches apply to every pipeline.

Each pipeline has a lead list, a call deck for phone follow-up, **Sent & replies** (its sent and failed
emails and its leads' replies) and Stats. **Unmatched replies** (`/replies`) holds replies from addresses on
no lead and tracks whether inbound mail is arriving, **Settings** holds the kill switch, connections (with a reply-loop check to run after each deploy) and
the do-not-email list, and **Operator
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
                                                        └──► ADRE roster, business websites
```

- **Request flow.** Pages are server components that read through `src/lib` and Prisma. Every change the
  operator makes is a server action in `src/lib/actions/` (validation, then one call into
  `src/lib/outreach/`). The rules live once in `src/lib/outreach/`: `send.ts` (every email goes through
  it), `inbound.ts` + `reply-classifier.ts` + `auto-mail.ts` (replies, opt-outs, bounces),
  `discovery.ts` + `site-evidence.ts` + `email-policy.ts` (finding addresses), `lead-actions.ts` and
  `lead-edit.ts` (status moves, edits), `stale-contacts.ts` (the 7-day move), `daily-run.ts` (the one daily
  run every pipeline uses, configured per pipeline in `src/lib/*-daily-run.ts`), `pipelines.ts` (the three
  pipelines' tables behind one interface).
- **Routes that aren't pages.** Six Vercel Cron jobs (`vercel.json`, Bearer `CRON_SECRET`): the four daily
  runs `/api/cron/garbage-ai-daily`, `/api/cron/vault-daily`, `/api/cron/dataleadsell-daily` and
  `/api/cron/room-designer-daily`, plus
  `/api/cron/stale-contacts` and `/api/cron/daily-report` (times in docs/operator.md → "Daily automation"); `/api/email-inbound` (the Cloudflare Email Worker in
  `workers/email-inbound/`, Bearer `EMAIL_INBOUND_SECRET`); `/api/health`; `/api/contact-card/…` (vCard).
  `src/proxy.ts` answers page requests with 503 while the database is down; `src/instrumentation.ts`
  checks the environment at startup.
- **Data stores.** One Postgres database (Neon in production), schema in `prisma/schema.prisma`,
  migrations in `prisma/migrations/` (additive; see docs/deployment.md). Main tables: `Lead` (Cold
  Outreach), `AgentLead` (dataleadsell), `HaulerLead` (Garbage AI) and `RemodelerLead` (Room Designer 3D), each
  with its `…Activity` history and send-log table (`LeadEmailSendLog`, `EmailSendLog`, `HaulerEmailSendLog`,
  `RemodelerEmailSendLog`);
  `OutreachRecipient` (the one-pitch-per-address ledger); `SuppressedEmail` (do-not-email list);
  `InboundReply` (every inbound message and the rules' verdict); `OutreachCorrection` (operator
  corrections); `PipelineRun` (cron runs); `AppSettings`, `PipelineSchedule`, `PipelineMeta`; ADRE and
  city-rotation tables. Nothing else is stored: no cache, queue or file store (the Worker's retry queue
  lives in Cloudflare).
- **External services.** ZeptoMail (SMTP, sending), Cloudflare Email Routing + Worker (receiving),
  Foursquare's open places data (discovery, loaded monthly into the `Place` table by a GitHub Actions
  workflow; see docs/deployment.md → "Business list"), ADRE (public roster download), the businesses' own websites (address lookup),
  Vercel (hosting, cron, SSO). Local development and CI use none of them: mail goes to an outbox or a local
  catcher, and `fetch` is stubbed in tests.
- **UI.** React 19 server components with small client components in `src/components/`, Tailwind v4.
  English-only by the client's request, with no translation layer (see "Known limitations").

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

**Discovery locally.** The search buttons read the `Place` table, which starts empty. Load it with
`PIPELINES_DIRECT_URL=<your dev database> python3 scripts/import-places.py` (about 15 minutes; see
docs/deployment.md → "Business list"), or use **+ Add lead by hand**.

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

- **English-only interface, by the client's request.** The owner decided on 2026-10-05 that the interface
  stays English-only, because the client asked for English only; there is no Spanish or French interface
  and no translation layer, and dates and numbers are formatted for the US. Strings are written directly
  in the components. Replies are separate: common Spanish, French, German, Portuguese, Italian and Dutch
  opt-outs are honoured, and any other reply in another language needs a look.
- **Replies the rules can't read with confidence wait for the operator.** Over a quarter (28.5%) of the
  synthetic development replies land on "needs a look" — including a reply that puts it off ("not right
  now", "maybe next quarter") without saying no, or only says it will be passed on — and nothing is
  emailed to such an address until the operator resolves it (docs/outreach-safety.md). A plain "no thanks" closes the lead and a "Thanks" /
  "Got it" changes nothing, without the operator; both also stop further email to the address, and neither
  is treated as an opt-out. The Unmatched replies page and the lead list show how many are waiting.
- **The business list is a monthly snapshot of the rotation's cities.** Searches only find businesses in the
  cities the pipelines rotate through, as of the last import, and only places Foursquare confirmed since 2020.
  Some will have closed since; a manual search of any other city says the city isn't loaded.
- **Leads found on Yelp before October 2026 are still stored** (their `source` starts "Yelp search") and
  still emailed by daily runs if waiting. Yelp's API terms say Yelp content must be deleted once access ends
  and can't be used for direct marketing; what to do with them is an owner decision, not yet made.
- **Email finding is a heuristic.** The business list has a website for most businesses (about 60%);
  for the rest, and for ADRE agents, `src/lib/website-finder.ts` guesses a few plausible domains from the name and checks them directly (no
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
- **Where the outreach data comes from is a business/legal question, not a code one.** All three pipelines email
  people found through Foursquare's open places data (before October 2026, Yelp's API) and Arizona's public
  ADRE roster, without prior opt-in. What CAN-SPAM
  explicitly requires is handled (a mailing address and a working opt-out in every email, opt-outs enforced
  before every send); whether sourcing addresses this way has a sound lawful basis has not been reviewed.
- `docs/archive/LEAD_GEN_PIPELINE_SPEC.md` is the historical spec the Cold Outreach pipeline was first built
  from. It does not describe the current system.
