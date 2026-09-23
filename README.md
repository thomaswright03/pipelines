# Pipelines

Thomas Wright's internal dashboard for Wright AI Solutions' email/SMS outreach pipelines. This is **not** a
multi-tenant product — there's one operator, gated by Vercel Deployment Protection (SSO), not an in-app
login system.

Two pipelines live here today:

- **dataleadsell.com** — finds real estate agents/brokers in Maricopa (AZ), Salt Lake and Utah (UT)
  counties via Yelp and Arizona's ADRE license roster, finds an email for each, and pitches a Probate
  Property Leads subscription.
- **Cold Outreach** — Wright AI Solutions' own client-acquisition pipeline (a full copy of "The Vault"),
  generic small-business outreach found via Yelp. Runs automatically once a day (see "Daily automation" on
  its page) as well as on demand.

A third entry on the dashboard, **AI Lead Responder**, is a separate always-on service (SMS auto-replies
for a different client) — it isn't code in this repo, just a link out to its own Vercel project.

## Running it locally

```bash
npm install
cp .env.example .env   # fill in real values — see that file for what each one is for
npx prisma migrate deploy
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) (the `run` skill/launch config uses port 4000 instead —
either works). The app validates required env vars at startup (`src/instrumentation.ts`) and refuses to
start with a clear message naming whatever's missing, rather than failing deep inside Prisma or nodemailer.

There's no separate local database — both local dev and the Vercel deployment point at the same Neon
Postgres instance (see `.env.example`). There's no seed script; the two pipelines start empty and populate
themselves via their own "Run pipeline" buttons.

## Deploying

Deployed via the Vercel CLI directly from local files (`vercel --prod`), not git-integrated — there's no
GitHub remote for this repo. Production env vars are set with `vercel env add <NAME> production`, and
`vercel.json` defines the two Vercel Cron jobs (see "Daily automation" below). After any `prisma/migrations`
change, run `npx prisma migrate deploy` against the same `PIPELINES_DIRECT_URL` before deploying — the app
doesn't run migrations itself at boot.

## Daily automation

Cold Outreach runs automatically once a day. The **time** it fires is fixed in `vercel.json` (`33 15 * * *`
UTC = 8:33 AM Arizona time — Vercel's free plan can't reschedule cron jobs without a redeploy) — but
**whether it runs at all, and how many leads it pulls per run**, are stored in the database and editable
live from the Cold Outreach page itself, no redeploy needed.

## Known limitations

- **Inbound reply detection is currently broken.** The Cloudflare Email Worker POSTs to
  `/api/email-inbound` to record when a lead replies, but that route sits behind Vercel Deployment
  Protection like every other route on this project — an external caller with no Vercel session gets
  Vercel's own 401 page, before the route's own `EMAIL_INBOUND_SECRET` check ever runs. Fix: enable
  "Protection Bypass for Automation" in Vercel's Project Settings → Deployment Protection, then have the
  Worker send the resulting secret as an `x-vercel-protection-bypass` header. Not yet done. Until then,
  replies and bounces have to be marked manually via the "Mark replied"/"Mark bounced" buttons on each
  lead.
- **No real bounce webhook.** ZeptoMail's SMTP relay doesn't hand back a provider-side message id the way
  the previous provider (Resend) did, so there's nothing to correlate a bounce webhook against yet. "Mark
  bounced" is the honest manual fallback.
- **Email-finding is a low-accuracy heuristic, not a guarantee.** Neither Yelp nor Arizona's ADRE roster
  gives a business's website, so `src/lib/website-finder.ts` guesses a handful of plausible domains from
  the business's name and checks them directly (no search engine involved — those all either block
  automated queries or require payment). Expect roughly 15–25% of scraped businesses to yield a real email,
  not 100%.
- **No automated test suite or CI.** There's no test framework installed and no `.github/workflows` — this
  repo also isn't on GitHub yet. `npm run build` (which runs `tsc --noEmit` as part of the Next.js build)
  is the only automated check today.
- **Where the outreach data comes from is a business/legal question, not a code one.** Both pipelines
  discover real people's names, phone numbers and (once found) emails via Yelp's API and Arizona's public
  ADRE license roster, then email them without prior opt-in. Whether that's on solid legal footing under
  CAN-SPAM (which governs *how* you can email people, not whether you can source their address this way) —
  and what a lawful basis for this outreach actually is — hasn't been reviewed here. Flagged for the
  business owner, not decided in code. (What CAN-SPAM does explicitly require — a physical mailing address
  and a working opt-out — is handled: every outreach email includes the mailing address, says "reply STOP",
  and a STOP reply is detected in `/api/email-inbound` and permanently suppresses that address across both
  pipelines, checked before every future send. That enforcement is only reachable once the Deployment
  Protection issue above is fixed — until then, nothing calls it in production.)
