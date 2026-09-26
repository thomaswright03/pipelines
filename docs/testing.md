# Tests

```bash
npm test               # vitest run
npm run test:watch
npm run test:coverage  # the same, plus a coverage report for src/
npm run build && npm run test:e2e   # browser smoke tests (Playwright; first time: npx playwright install chromium)
npm run format         # Prettier; CI runs `npm run format:check`
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
| `tests/send.test.ts` | One pitch per address, overlapping sends (including the same lead from two tabs), crash-after-claim, pause, SMTP failure handling |
| `tests/inbound.test.ts`, `tests/reply-classifier.test.ts` | Reply and opt-out classification |
| `tests/auto-mail.test.ts` | Automatic replies (headers, subjects, wording) change nothing but the history and still reach the call deck; bounce notices in Postfix/Gmail/Exchange/DSN form mark the send bounced; unmatched bounces; the Stats reply/opt-out/automatic figures in both pipelines |
| `tests/call-deck.test.ts` | Call-deck cards (company, place, emailed date, latest history) and an order a saved call doesn't reshuffle |
| `tests/connections.test.ts` | Settings → Connections: "Not confirmed yet" on a fresh install, "Working" only after a reply/send/search/test, the no-replies warning for old sends, Test connection passing and failing (no email sent), failed and overdue runs, missing secrets, no setting names in the copy |
| `tests/connection-status-list.test.ts` | The Connections list as rendered: each tone's badge, "Not confirmed yet", next steps, where Test connection appears |
| `tests/bulk-send-run.test.ts` | The bulk-send dialog's loop: progress, Stop, three-failures stop, paused stop, lost server, the closing summary |
| `tests/call-deck-session.test.ts` | The call deck's saved place: restore, start over, corrupt data, no or throwing browser storage |
| `tests/rules-version.test.ts` | The rules version: changes with a rule, stored on every inbound reply and every accepted address |
| `tests/status-constraint.test.ts` | The database refuses unknown lead statuses (and its list matches the app's); unknown ones are labelled as such |
| `tests/proxy.test.ts` | Page requests during a database outage get 503; the probe is reused for 5 s |
| `tests/db-health.test.ts` | Database-outage detection and `/api/health` |
| `tests/discovery.test.ts`, `tests/email-finder.test.ts` | Discovery and email lookup |
| `tests/adre.test.ts` | Resumable ADRE import; a roster whose columns changed, or that lists nobody in the county, is reported instead of "succeeding" with zero |
| `tests/cron.test.ts` | The cron routes, including a database outage answered with a code and no database error text |
| `tests/daily-run.test.ts` | What "businesses to check per run" yields; leftovers emailed by the next run, including when Yelp fails (run "partial", city not used up); the 60 s budget (fake clock); skipped leads don't fail a run |
| `tests/replies.test.ts` | Replies after the stale-contacts move, Lost-lead review flag, Mark replied, duplicate delivery, database outage and retry, stale-contacts race |
| `tests/worker-contract.test.ts` | The reference Email Worker (`workers/email-inbound`) against the real route: MIME parsing, headers and `messageId` forwarded, bypass header, resend on 503/no response, none on 400/401, 72-hour give-up |
| `tests/send-refusals.test.ts` | Addresses the recipient's server refuses (5xx, and repeated 4xx): the lead is flagged and leaves the queues, bulk sends and daily runs carry on, Connections stays "Working"; every failed attempt shows in History and on the list; a fresh send claim shows as "in progress" |
| `tests/stats.test.ts` | Stats, including reply rate and Arizona days; pitch versions named in plain words ("Email version 2 (in use since …)"), never by fingerprint |
| `tests/components/lead-form.test.tsx` | Lead forms never cut text: over-long input is kept, counted and refused with the field's error |
| `tests/client-disconnect-log.test.ts` | Only React's "destination stream closed early" (a browser leaving mid-response) is dropped from the server log |
| `tests/lead-actions.test.ts` | Stage rules, moves racing a reply, the Settings do-not-email list |
| `tests/site-evidence.test.ts` | Guessed sites must show the lead's phone/street, or the city plus the name in the title; duplicate detection by name plus phone/address/city |
| `tests/lead-edit.test.ts` | Editing (address rules, links to the holder, pitched leads keep their address), deleting, unverified addresses |
| `tests/unmatched-replies.test.ts` | Replies from unknown addresses: listed, attached to a lead, dismissed; the "no replies lately" warning |
| `tests/greeting.test.ts` | dataleadsell greets agents by first name; the preview is what's sent |
| `tests/e2e.test.ts` | One run per pipeline through the same server actions the pages use |
| `tests/actions.test.ts` | Every server action in `src/lib/actions/`: validation, happy path, Yelp and database failures |
| `tests/review-findings.test.ts` | Plain opt-out phrasings end to end, "needs a look" replies, reply/call history vs. the notes limit, unreachable websites, Find email guards, bouncing after the stale-contacts move, correction counts |
| `tests/rules.test.ts` | Brokerage-site address matching, where mail goes, phones, states, money, forms |
| `tests/heuristics-eval.test.ts` | The reply classifier's outcomes (unsafe, needs a look, handled automatically) and precision/recall of the other heuristics (automatic replies, bounces, brokerage addresses, guessed sites) on development and held-out splits in `tests/corpus/` (see below) |
| `tests/reply-hold.test.ts` | Interested replies with opt-out words, footers, polite opt-outs: flagged, never suppressed or counted; a reply that needs a look holds every send to its address (flagged leads, leads added later, unmatched replies) until resolved; out-of-office wording with a yes |
| `tests/reply-verdicts.test.ts` | Plain no's and thank-you-only replies end to end: a "Thanks" isn't flagged, counted or suppressed and changes nothing on the lead; a "No thanks" closes a lead still being worked (Lost / Not interested) and flags one that got further; both hold every later send to the address ("already answered"), in either pipeline and for an unmatched reply until dismissed; attaching a plain no closes the lead; reopening or Mark replied is counted as a correction; the bulk preview's skip counts match what the send then does, reason by reason |
| `tests/kill-switch.test.ts` | `OUTBOUND_EMAIL_DISABLED`: how the value is read; a single send, the bulk preview and a bulk chunk, the daily cron run and the mail layer itself all refuse with it set, and nothing reaches the transport; the Settings switch can't undo it; sending resumes when it is unset |
| `tests/production-signals.test.ts` | The "replies not arriving" warning (48-hour grace, never / a silent week / 20 silent sends, cleared by any inbound message) and "How found addresses are doing" (sends, bounces, wrong-person replies and hand corrections per source and rules version) |
| `tests/contact-card.test.ts` | The call deck's "Add to Contacts" vCard: escaping, file name, no phone, unknown pipeline or lead |
| `tests/components/operator-controls.test.tsx` | The email lookup sweep, the ADRE import, the city searches, the Cold Outreach stage panel and both error pages: progress, Stop, success, refusal, lost connection, database outage |
| `tests/pages.test.tsx` | Every page rendered with representative data: the dashboard's numbers, lists, lead pages (send offered, needs-a-look warning, do-not-email, 404), forms, Stats, call decks, Replies, Settings (paused, and switched off on the server), Help, the root layout (its paused, server-off and replies-not-arriving pills), the dashboard's replies warning and the database-outage page |

**Coverage floors.** `npm run test:coverage` fails if `src/lib/outreach` drops below 90% of lines,
`src/lib/actions` below 85%, `src/components` below 85% or `src/app` (the pages) below 75%
(`vitest.config.ts`); CI's summary prints lines covered per area. Every page is rendered with
representative data — empty, normal, a flagged or opted-out lead, outbound email paused, a missing lead —
by `tests/pages.test.tsx` (`tests/render-page.tsx` awaits the server components and renders their HTML).
Components are tested in jsdom with Testing Library (`tests/components/*.test.tsx`: the lead page's email
controls, the bulk-send dialog, the do-not-email list, unmatched replies, the pipeline controls, the email lookup
sweep, the ADRE import, the city searches, the stage panel, the error pages, the call deck, the dashboard cards, the theme switch, the last-run line and the lead list's markers — pending,
success, refusal and network-failure states) and end to end by the browser tests; the logic inside the more
involved client components (the bulk-send loop, the call deck's saved place) lives in `src/lib/` where it is
unit-tested. The confirm dialog's focus and Escape handling need a real browser and are covered by the browser tests.

## Browser smoke tests

`e2e/smoke.spec.ts` (Playwright) runs against a production build served on port
4100. They cover adding a lead with an invalid email, a single send, a bulk send stopped midway (at most
two emails after Stop), pause/resume, Enter confirming a send but cancelling a destructive action,
editing a lead (including the link to the lead holding an address), deleting a lead, attaching an
unmatched reply, stale messages clearing, per-page tab titles (including "Page not found"), the
unsaved-changes prompt on the lead form, reading a
Stats bar's date and count by keyboard focus, the lead list at 375–2560 px, the call-deck card's context
and its place surviving a refresh, the single empty-list message, the sender address never breaking
inside itself (375–2560 px), marking a lead Lost (one control, reason required), and Settings →
Connections including Test connection, the phone header (one row of at most 64 px, the menu, Escape),
the lead list on the first screen at 1440×900 with column headers that stay pinned while scrolling, and
44 px tap targets on a phone, the desktop header staying on one row at 1024–1440 px with every status
pill showing (whole pill text at 1440 px), and the do-not-email list at 375 px (no sideways scroll, each
address whole and wrapping only after "@" or a hyphen or before a dot, a 44 px Remove). On CI a failed browser test is run once more so the report shows
whether it is flaky, but a test that only passes on the retry still fails the run (`failOnFlakyTests`).
The server uses `EMAIL_TRANSPORT=outbox` (mail is written to `test-results/e2e-outbox`, never delivered) and its own
database, `E2E_DATABASE_URL` (default `postgresql://ci:ci@localhost:5432/pipelines_e2e`), which
`e2e/prepare-db.mjs` creates and migrates. It refuses non-local hosts.

## CI

`.github/workflows/ci.yml` runs on every push and pull request. It uses a throwaway `postgres:16` service
container and runs `npm ci`, `npm run build` (including the type check), `npm run lint`, the Prettier
check (`npm run format:check`), the test suite
with coverage floors (the summary appears on the run page), the heuristic precision/recall scores, and
the browser smoke tests. CI has no secrets and
reaches no external service other than downloading Chromium.
