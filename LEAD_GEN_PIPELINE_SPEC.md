> **Historical document.** This is the spec the Cold Outreach pipeline was originally rebuilt from. It does
> not describe the system in this repo any more: discovery uses Yelp, not Selenium; sending uses ZeptoMail;
> the daily run is automated; and the send/opt-out rules live in `src/lib/outreach/`. Read `README.md` and
> the code for current behaviour. This file is kept for its background on why some decisions were made.

# Lead Gen Pipeline — Rebuild Spec

This document is written for an AI coding assistant to rebuild a specific cold-outreach lead
generation pipeline from scratch. It describes the exact data model, stage transitions, and
component behavior of a working system — including the non-obvious gotchas that cost real
debugging time to discover. Follow this precisely rather than inventing your own version of any
piece described here; where a design choice looks arbitrary, it usually encodes a real constraint
explained inline.

## 0. Context and hard constraints

This pipeline exists inside a personal Next.js business CRM (App Router, Server Actions, Prisma
ORM). It does NOT need to live in that exact stack, but the constraints below shaped every design
decision and should shape yours too if you're rebuilding this for a solo operator:

- **No paid APIs.** Business discovery uses browser scraping (Selenium), not the Google Places
  API — the owner explicitly rejected Places API due to per-request cost at scraping volume
  (~50 businesses/hour, hours/day). If cost is not a concern in your context, Places API is a
  legitimate, far more reliable replacement for the scraping step described in §2 — but don't
  substitute it silently; it changes the deployment story (see §8).
- **No scheduled background automation for the expensive/fragile steps.** Scraping + email-finding
  + sending used to run hourly via a cron-like job (macOS `launchd`). It was removed entirely
  after repeated failures (Selenium/Chrome hangs, laptop asleep, low battery) in favor of a single
  manual "Run pipeline now" button that a human clicks. **Do not reintroduce automatic scheduling
  for scraping/sending unless explicitly asked** — this was a deliberate, hard-won product
  decision, not an oversight.
- **A separate, much lighter daily check IS scheduled** (§9) — it only reads existing data and
  Mail.app, no scraping, no sending, no paid APIs. This distinction (heavy pipeline = manual only;
  lightweight read-only check = OK to schedule) is the actual rule to follow, not "no automation
  at all."
- **Local-machine dependency is a known, accepted limitation**, not a bug to solve by adding more
  infrastructure. Scraping needs real Chrome + Python; sending/reading mail uses macOS Mail.app via
  AppleScript. Both only work when run on the owner's Mac. A full "make everything cloud-based"
  migration (Google Places API for discovery, SMTP/IMAP instead of Mail.app) was scoped in detail
  and then explicitly rejected on cost grounds. Don't attempt that migration unless asked.

## 1. Data model

```prisma
model Lead {
  id               String    @id @default(cuid())
  name             String
  company          String?
  email            String?
  phone            String?
  address          String?
  city             String?   // the city the scrape query targeted — NOT parsed from address
  state            String?   // two-letter state abbreviation
  website          String?
  source           String?
  status           String    @default("new")
  // new | contacted | responded | appointment_set | working_for | paying_client
  // | cold_call_list | contactless_list | lost
  callOutcome      String?   // no_answer | unable_to_contact | not_interested | interested
                             // | too_busy | no_need  (set by manual UI, see §7)
  starred          Boolean   @default(false)
  lastEmailedAt    DateTime?
  repliedAt        DateTime? // a REAL reply was detected (automated or manual override)
  ourReplyAt       DateTime? // we replied back — always manual, never auto-set
  estimatedValue   Float?
  notes            String?
  nextFollowUpDate DateTime?
  appointmentAt    DateTime? // set when status moves to appointment_set
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  activities LeadActivity[]
  emailLogs  EmailSendLog[]
}

model LeadActivity {
  id     String   @id @default(cuid())
  leadId String
  lead   Lead     @relation(fields: [leadId], references: [id], onDelete: Cascade)
  type   String   // call | email | meeting | note
  notes  String
  date   DateTime @default(now())
}

// One row per outreach SEND ATTEMPT. Kept even if the lead is later
// deleted (email stored directly on the row) so historical send/bounce
// stats never silently lose data.
model EmailSendLog {
  id        String    @id @default(cuid())
  leadId    String?
  lead      Lead?     @relation(fields: [leadId], references: [id], onDelete: SetNull)
  email     String
  sentAt    DateTime  @default(now())
  bounced   Boolean   @default(false)
  bouncedAt DateTime?
}

// Tracks which "city, state" pairs the scraper has already used, so the
// random picker for the next scrape target never repeats one until the
// whole pool has been exhausted.
model ScrapedCity {
  id        String   @id @default(cuid())
  city      String
  state     String
  queriedAt DateTime @default(now())
  @@unique([city, state])
}
```

A `Lead` optionally converts into a `Client` (a separate model in the wider CRM) — not required
for the pipeline itself, but the status transition in §5 (`working_for`) assumes this exists.

## 2. Stage / status model — exact transition rules

```
new ──(email sent)──> contacted ──(real reply)──> responded ──(manual)──> appointment_set
                                                                                │
                                                                        (first project
                                                                         created for
                                                                         the client)
                                                                                ▼
                                                                          working_for
                                                                                │
                                                                            (manual)
                                                                                ▼
                                                                         paying_client

new ──(no email found, has phone)────────────────────> cold_call_list
new ──(no email found, no phone)─────────────────────> contactless_list
contacted ──(7+ days, no reply)──────────────────────> cold_call_list / contactless_list
contacted ──(reply looks automated/bounce)───────────> cold_call_list / contactless_list

any non-terminal status ──(manual "lost" reasons, or confirmed bounce)──> lost
```

Rules, precisely:

- **`new`**: freshly created (scraped or manually added), no email sent yet.
- **`new` → `contacted`**: outreach email successfully sent. Sets `lastEmailedAt = now`,
  `repliedAt = null`.
- **`contacted` → `responded`**: a *real* reply detected (§6) — not an autoresponder, not a
  bounce. Sets `repliedAt`.
- **`responded` → `appointment_set`**: manual, via a date picker in the UI. Sets `appointmentAt`.
- **`appointment_set` → `working_for`**: automatic side effect of creating the FIRST project/job
  for that lead's client. Only fires if the lead's current status is exactly `appointment_set` —
  a lead already further along must not be bumped backward or sideways by this.
- **`working_for` → `paying_client`**: manual.
- **`lost`**: manual, with a required reason (`not_interested`, `too_busy`, `no_answer`,
  `no_need`, `unable_to_contact`) — OR automatic when a bounce confirms the email address doesn't
  exist (reason always `unable_to_contact` in that case). **Never auto-set `lost` on a lead that
  is already `paying_client`** — a late bounce on some unrelated later send must not undo a closed
  deal.
- **Phase-2 routing** (`cold_call_list` / `contactless_list`, see §7): triggered by any of —
  (a) email-finding came up empty for a `new` lead, (b) 7+ days since `lastEmailedAt` with no
  reply on a `contacted` lead, (c) a reply arrived but its subject looks automated (§6). Routing
  picks `cold_call_list` if the lead has (or can find) a phone number, else `contactless_list`.

## 3. Business discovery (scraping)

- A city/state picker cycles through a fixed list of target cities, using `ScrapedCity` to avoid
  repeating one until the whole pool is exhausted (then reset and reuse). Store `city`/`state` on
  each created `Lead` at creation time — this is the query target, not something parsed from a
  scraped address, and is later used for the cold-call timezone display (§7).
- Scraping itself: a Python script driving `undetected_chromedriver` against Google Maps search
  results for `"<business type> in <city>, <state>"`, extracting name/phone/address/website per
  result. Cap results per run (e.g. 50) to keep a single run bounded.
- Dedupe newly scraped candidates against existing leads by normalized (trimmed, lowercased) name
  before creating rows.
- **GOTCHA**: a long-lived scraping process can hang indefinitely (a CAPTCHA, a lost connection to
  Chrome, a stuck page load) with no error and no output. Any wrapper that shells out to this
  script MUST enforce a hard timeout and kill the *entire process group* (Python + any
  Chrome/chromedriver it spawned), not just the immediate child — a lone stuck Python subprocess
  reference is not enough; use `detached: true` on spawn and `process.kill(-pid, "SIGKILL")` (or
  the equivalent in your runtime) against the negative PID.

## 4. Email finding

- For a lead with no email: fetch the business's own website (if scraped) and look for a
  `mailto:` link or an email-shaped string on the homepage / a `/contact` page.
- If no website, or nothing found there: fall back to a Python/Selenium Google search for
  `"<business name> email"`, including parsing Google's AI-generated answer box, since that
  frequently surfaces a contact email search-results scraping alone would miss.
- If still nothing: route the lead to Phase 2 (§7) rather than leaving it stuck in `new` forever.

## 5. Outreach sending

- A single email template function takes just the business name and returns `{subject, body}`.
  **The body must include a real physical mailing address** — this is a CAN-SPAM compliance
  requirement for commercial email, not optional boilerplate. Refuse to send (log and abort,
  don't silently skip) if no real address is configured.
- Sending goes through the local mail client actually configured on the operator's machine — for
  macOS this means driving Mail.app via AppleScript rather than a transactional email API, because
  the whole point is that replies/bounces land in the operator's own real inbox where they're
  already looking. Always send from one specific, hardcoded sender account — never whatever
  account happens to be the OS's current default, since that's a mutable, easy-to-change system
  preference and an outreach system should not silently start sending from the wrong address.
- On successful send: create an `EmailSendLog` row, set the lead's `lastEmailedAt = now`, clear
  `repliedAt`, set status to `contacted`.

### AppleScript specifics (macOS Mail.app)

```applescript
tell application "Mail"
  set newMessage to make new outgoing message with properties {subject:"...", content:"...", sender:"you@example.com", visible:false}
  tell newMessage
    make new to recipient at end of to recipients with properties {address:"lead@example.com"}
  end tell
  send newMessage
end tell
```

Escape any interpolated string for AppleScript by replacing `\` → `\\` and `"` → `\"` (in that
order) before embedding it in a script — those are the only two characters AppleScript string
literals treat specially; literal newlines are fine as-is.

## 6. Reply and bounce detection

Both read from Mail.app, scoped to **only the outreach sender account's own INBOX/Junk/Spam
mailboxes** — not the OS's unified cross-account inbox. This isn't just an optimization: every
outreach email goes out from one account, so a reply can only ever land there. It also happens to
be dramatically faster (a unified-inbox whose-filter across every message in every account
measured ~70s at a 21-day window and became outright unreliable beyond that; scoping to one
account's mailboxes measured ~24s at 90 days).

```applescript
tell application "Mail"
  set targetAccount to (first account whose name is "you@example.com")
  repeat with mb in every mailbox of targetAccount
    set mbName to name of mb
    if mbName is "INBOX" or mbName is "Junk" or mbName is "Spam" then
      set theMessages to (messages of mb whose date received > ((current date) - N * days))
      repeat with m in theMessages
        -- collect sender, date received, subject
      end repeat
    end if
  end repeat
end tell
```

### Reply checking

- Candidates: leads with `email` set, `lastEmailedAt` set, `repliedAt` still null.
- Lookback window: size it dynamically — don't always scan 90 days if nothing needs it. Take the
  oldest pending `lastEmailedAt` among candidates, compute days-since, clamp into a
  [min, max] range (e.g. 3–90 days). A run with everything emailed in the last day or two shouldn't
  pay for a 90-day scan it doesn't need.
- For each candidate, find the newest message from that email address received *after* the lead's
  `lastEmailedAt`.
  - Found, and lead is still `contacted` (never move a lead backward if it's already progressed
    further): if the message's subject matches an auto-reply pattern (see below), route to Phase 2
    — an autoresponder means the email channel didn't reach a human, functionally the same as no
    response. Otherwise, mark it a real reply: `repliedAt = receivedAt`, `status = responded`.
  - Not found, and `lastEmailedAt` is 7+ days ago: route to Phase 2 (stale, not a rejection, but
    time to try another channel).
- Auto-reply subject regex (case-insensitive), tuned for common phrasing rather than parsing the
  `Auto-Submitted` header (which requires the much-slower full raw message source):
  ```
  /out of (the )?office|automatic reply|auto-?reply|away from (my |the )?(email|office)|on vacation|currently unavailable/i
  ```

### Bounce checking

- Candidates: `EmailSendLog` rows where `bounced` is still false.
- Filter Mail.app messages by sender containing `"mailer-daemon"` *before* reading full message
  content — only a handful of messages ever match even across 90 days, so this stays fast (~3–14s)
  regardless of window size, unlike reply-checking which has to look at every message.
- Parse the message's DSN body with these two regexes — **do not** parse the human-readable
  sentence Gmail/etc. render, which varies by provider and failure type:
  ```
  Final-Recipient:\s*rfc822;\s*(\S+)      -- which address actually failed
  Action:\s*(\w+)                          -- must be exactly "failed" to count
  ```
  A DSN with `Action: delayed` just means still-retrying/queued, not a confirmed bad address —
  don't act on it.
- On a confirmed bounce (`Action: failed`) after the log's `sentAt`: mark the log `bounced` with
  `bouncedAt`, and if the associated lead isn't already `paying_client`, set it to `lost` with
  `callOutcome = unable_to_contact`.
- Provide a manual override in the UI for the case the automated parser gets wrong: sometimes a
  bounce notice looks enough like a real reply that it gets mis-classified as `responded`. A
  "this was actually a non-delivery notice" button should: un-set `repliedAt`/`ourReplyAt`, mark
  the most recent non-bounced `EmailSendLog` for that lead as bounced, and route to Phase 2.

## 7. Phase 2 — phone outreach

When email isn't working (no address found, gone stale, or bounced/auto-replied), route to phone:

```
function routeLeadToPhase2(lead):
  phone = lead.phone
  if phone is null:
    phone = tryFindPhoneNumber(lead.name)   # same Google-search pattern as email finding
  status = phone ? "cold_call_list" : "contactless_list"
  update lead: { status, phone: phone ?? unchanged }
```

### Cold-calling UI

A one-card-at-a-time deck (not a list/table) — mimics a flashcard app so a caller works
sequentially without re-deciding what's next:

- Shows: business name, phone as a `tel:` link, city/state, and — surprisingly high-value — the
  **current local time at that lead's location**, so the caller doesn't cold-call someone at 6am
  their time. Compute from a state→IANA-timezone lookup table (all 50 states + DC), then
  `Intl.DateTimeFormat(..., { timeZone, timeZoneName: "short" })`. **Arizona is a real edge case**:
  it's geographically Mountain time but does not observe DST, so it needs `America/Phoenix`
  specifically — using generic `America/Denver` for Arizona will be off by an hour for roughly half
  the year. A handful of other states (TX, TN, KY, IN, MI, FL, ND, SD, NE, KS, ID, OR) technically
  span two zones; mapping each to whichever zone covers the majority of its population is a fine,
  accepted approximation — don't try to get this exactly right without real per-city geocoding.
  Refresh the displayed time on an interval (e.g. every 30s) so it stays accurate if a card sits
  open a while.
- Four outcome buttons, each mapping to a `{callOutcome, status}` pair:
  | Outcome | callOutcome | status change |
  |---|---|---|
  | Didn't Answer | `no_answer` | **none** — stays in the list; this is the one deliberate exception, meant to come back up for a retry another day |
  | Invalid Number | `unable_to_contact` | → `lost` |
  | Not Interested | `not_interested` | → `lost` |
  | Interested | `interested` | → `responded` |
- A free-text notes field, appended (not overwritten) to the lead's notes with a timestamp on
  confirm.
- Confirming validates an outcome was actually selected, saves, then advances the LOCAL index to
  the next card — independent of whatever status the save produced. A "Didn't Answer" card should
  disappear from *this session's* deck even though the underlying lead is still, correctly, in
  `cold_call_list` — don't re-show it in the same pass just because its status didn't change.
- An "Add to Contacts" action: don't try to write to the phone's native contacts via JavaScript —
  there is no such browser API. Instead, serve a vCard from a same-origin endpoint with
  `Content-Type: text/vcard` and, critically, `Content-Disposition: inline` (not `attachment` —
  that just downloads a file; `inline` is what makes a phone browser open its native "Add Contact"
  sheet directly). A minimal vCard:
  ```
  BEGIN:VCARD
  VERSION:3.0
  N:<Name>;;;;
  FN:<Name>
  TEL;TYPE=CELL:<Phone>
  END:VCARD
  ```
  Escape `\`, `,`, `;`, and newlines in interpolated values per RFC 6350.
- If this pipeline is reachable from a phone (see §8), build a **separate, sidebar-free route**
  that shows only this flashcard deck — not a responsively-shrunk version of the full desktop app.
  Cold-calling from a phone is the one workflow that actually needs mobile access; the rest of a
  CRM usually doesn't, and trying to make everything responsive is far more work than one focused
  view.

## 8. Local vs. deployed split

If part of this is deployed to a serverless host (e.g. Vercel) for remote/mobile access to lead
*data*, understand exactly what can and can't run there:

- **Can run anywhere**: reading/updating lead status, cold-call outcome buttons, viewing pipeline
  stats — anything that's just database reads/writes.
- **Cannot run on a serverless host**: scraping (needs real Chrome + Python — most serverless
  platforms have no Python runtime at all) and Mail.app-driven sending/reply-checking (AppleScript
  only works on macOS with Mail.app actually running). A "Run pipeline now" button will fail there
  with something like `python3 not found` — that's an expected, permanent limitation of this
  architecture, not a bug to chase. The fix isn't error-handling; it's knowing not to click that
  button from the deployed version.
- The database should be a real hosted database reachable from both places (e.g. Turso/hosted
  libSQL), not a local file, so the local machine and the deployed app are always looking at the
  same data.
- **GOTCHA**: if using Prisma with a driver-adapter-based hosted SQLite (e.g. Turso), the Prisma
  CLI's own migration commands (`migrate dev`/`migrate deploy`) may not be able to connect to that
  URL scheme at all (a real, current limitation — `libsql://` specifically errors with "scheme not
  recognized"). Work around it by applying migration SQL directly via the underlying client
  library (e.g. `@libsql/client`'s `createClient`) and manually inserting a matching row into
  Prisma's own `_prisma_migrations` bookkeeping table (with an accurate sha256 checksum of the
  migration file) so Prisma's own drift-detection doesn't get confused later. When you do this,
  **strip full-line SQL comments (lines starting with `--`) before splitting the file on `;`** —
  splitting first and filtering lines that merely *start with* `--` will incorrectly drop an entire
  statement whenever a comment shares a line-group with real SQL, silently losing part of the
  migration.

## 9. The one thing that IS allowed to be scheduled

A separate, small daily script — not the pipeline above — that:

1. Runs `checkReplies`/`checkBounces` (the exact same functions the manual button uses — don't
   duplicate the logic).
2. Checks for reminders due today or overdue.
3. **Always sends exactly one email** — an "all clear" message when there's nothing to report, not
   silence. The entire point is that *silence itself* should mean something is broken, not that
   nothing happened today. A version that only emails when there's something to report is strictly
   worse: you can't tell "nothing happened" apart from "the script didn't run."
4. Wraps its own top-level error handler in a *second*, independent try/catch that attempts to
   send a "the daily check crashed: <error>" email even on total failure — otherwise a crash
   produces exactly the silence you built step 3 to eliminate. If even that email fails to send,
   there's genuinely nothing left to do but log it.
5. Reuses the same retry-once-after-a-pause helper as everything else (see §10) for each database
   call, since a hosted database is a network call and will occasionally have a transient blip.

Schedule this with the OS's own lightweight mechanism (e.g. macOS `launchd`, a `StartCalendarInterval`
of once daily) rather than anything more elaborate — it's cheap enough that a full job
scheduler/queue would be overkill.

## 10. Cross-cutting gotchas (apply everywhere)

- **A standalone script runner (e.g. `tsx`) does NOT auto-load `.env` files the way a full
  framework's dev server does.** Any code that might be imported by both the framework app *and* a
  bare standalone script (the database client, any module that reads `process.env` for
  configuration) must explicitly `import "dotenv/config"` at its own top — don't rely on it having
  been loaded by whatever imported you. Getting this wrong doesn't throw an error; it silently
  falls back to whatever default the code has (a local file instead of the real hosted database, a
  system binary instead of the one actually configured) and looks like a data or logic bug instead
  of a config-loading bug. This is the single most expensive class of bug in a system like this —
  budget real verification time for it: if a script "succeeds" but the change doesn't show up in
  the real app, suspect this before anything else.
- **Retry transient network failures once, with a short pause, on every database call in
  long-running scripts** — a hosted database is a real network dependency and will occasionally
  return a bare fetch failure with no other symptom. One retry is enough to ride out a blip; it is
  not enough to guarantee success, which is exactly why §9's crash-notification email still
  matters even with retries in place.
- **Any UI action that permanently removes something a user might not have meant to remove should
  ask for confirmation first** — a step, a lead, a scheduled item. This is easy to skip when first
  building a feature and easy to add later; add it up front.
- **When a background job's process might legitimately hang** (a scraper, a browser automation
  step), always enforce a timeout that kills the whole process tree, not just the direct child.

## 11. Suggested build order

1. Data model (§1) and a way to manually create/edit a `Lead` — nothing automated yet.
2. Manual outreach send (§5) + manual reply/bounce marking, no automation — prove the data model
   and status transitions (§2) are right by driving them by hand first.
3. Reply/bounce auto-detection (§6) as functions callable on demand (a button), not scheduled.
4. Scraping (§3) and email-finding (§4), wired into one manual "run pipeline" action that chains:
   pick city → scrape → dedupe → create leads → find email per lead → send → check replies/bounces.
5. Phase 2 phone routing and the cold-call UI (§7).
6. The daily lightweight check (§9), scheduled.
7. Only then, if actually needed: a deployed/remote-accessible version (§8), scoped to what can
   actually run there.

Building automation (step 4+) before the manual, single-lead version (steps 1–3) works end to end
is the most common way to end up debugging three problems at once instead of one at a time.
