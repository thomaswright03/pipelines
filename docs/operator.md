# Operating the pipelines

The in-app **Operator guide** (`/help`) is the day-to-day runbook: the emergency stop, the daily checks,
replies that need a look, held-back leads and reading Connections. This page describes what each screen
shows and what the app does on its own, for the operator and for whoever supports them.

## What each screen shows

Each pipeline has a lead list, a **call deck** for phone follow-up, and **Stats**. Every lead page has
**Edit details** and **Delete lead…**. **Replies** (`/replies`) shows whether replies are arriving and lists
replies from addresses that match no lead (and bounce notices that name no lead), so they can be attached
to the right one. **Settings** (`/settings`) holds the switches that apply to every pipeline,
**Connections** (whether sending, reply delivery, every scheduled job — the three daily runs, the
call-deck move and the daily report email — and Yelp are working, with the next step
when one isn't, and a **Test connection** button for email and Yelp) and the searchable do-not-email list.
**Operator guide** (`/help`, linked from Settings and every page's footer) is the one-page runbook for
day-to-day operation: the emergency stop, the daily checks, marking replies by hand, held-back leads and
reading Connections.

The **dashboard** (`/`, headed "Cold email outreach") says what the tool does and shows, for each
pipeline, how many leads are ready to email, waiting on a reply, in Responded and on the call deck (each a
link), plus how many replies need a look. "Ready to email" is what **Send outreach** would email right now:
New leads whose address was already pitched, is shared with another lead in the batch, is on the
do-not-email list or has a reply waiting aren't counted (the pipeline page says how many it will skip). Words like *call deck*, *held back*, *needs a look* and *ADRE* are
explained in the Operator guide's **Glossary** (`/help#glossary`, linked from the dashboard), and each
status badge explains itself on hover.

The **header** shows up to three pills, on every page and at every width: **Sending paused** (the Settings
switch) or **Sending off (server)** (the `OUTBOUND_EMAIL_DISABLED` environment variable), **Replies not
arriving** (see "Is it working?" below), and, outside production, where "sent" mail really goes. Where the
header is narrow (a phone, or a laptop-width window) each pill shows one word — **Paused**/**Off**,
**Replies**, **Test mode**/**Local mail** — so the header stays one row; hover over or tab to a pill for
what it means, and on a phone the Menu lists each in full.

Each call-deck card shows the lead's company or brokerage, city/state with the local time, when the pitch
was emailed (or "Never emailed"), the latest history entry, and a link that opens the lead page in a new
tab. A lead whose reply is flagged **Reply needs a look** (for example a complaint that reached a lead
already on the list) carries that warning and its reason at the top of its card. The deck keeps its place
when the page is refreshed (per browser tab); **Start over** reloads the current call list. A deck holds
200 cards; the counter shows the true size of the list ("Card 1 of 340"), and the end of a deck offers
**Load the next cards**, which continues after the last card (`?after=<lead id>`), so a list of any length
can be worked through.

On a lead page, the status and action panels (Move to…, Send outreach email, Mark opted out, Edit, Delete)
come first on a phone, straight under the name; from the `md` breakpoint up they sit in the right-hand
column beside the details. Every pipeline's lead pages and Stats pages share one layout each
(`LeadPageLayout` in `src/components/LeadDetailParts.tsx`, `src/components/PipelineStatsPage.tsx`). There is one way to mark a lead Lost, in
every pipeline: **Move to… → Lost**, which asks why (Not interested, Too busy, No answer, No need, Unable
to contact) before it confirms, and keeps the reason on the lead. **Mark bounced** is only offered while a
bounce is still possible (not after a reply opted the lead out).

The interface is English-only, by the client's request (the owner's decision of 2026-10-05; README →
"Known limitations"). A reply in another language is honoured when it is a common opt-out and otherwise needs a
look.

A third dashboard card, **AI Lead Responder**, links out to a separate Vercel project. It is not code in
this repo.

## Garbage AI

Garbage AI (`/garbage-ai`) pitches trash, recycling and dumpster-rental **haulers** an AI that texts back
every online lead they get, day or night, and offers a 15-minute demo with Max Garrett (whose number is in
the signature, since he makes the follow-up calls). Its leads are `HaulerLead`s; the pitch is
`src/lib/garbage-ai-email-template.ts` and its switches are in `src/lib/garbage-ai-config.ts`.

- **Who it never emails** (`src/lib/garbage-ai-targeting.ts`): current clients (Mountain High Disposal,
  Eastern Waste & Recycling, Garden State Bin Cleaning — matched by name, company or email domain), national
  and large regional haulers (WM, Republic Services, Waste Connections, GFL, Casella, Rumpke, Waste Pro,
  Recology), city and county sanitation or public-works departments, and any hauler in Mountain High
  Disposal's service area (32 Denver-metro and Northern Colorado cities). Searches leave them out before any
  lookup and never pick a city in that area; a hauler added or edited by hand is checked by the send rules
  (`neverPitch` in `src/lib/outreach/send.ts`). The lead list marks such a hauler **Never emailed**, and its
  page shows the reason in place of the Send button.
- **Daily run**: 8:00 AM Arizona time (`/api/cron/garbage-ai-daily`), on by default with 30 haulers checked
  per run; turn it off or change the number in the **Daily automation** panel on the Garbage AI page. It is
  the shared daily run (`src/lib/outreach/daily-run.ts`), so pausing outbound email stops it completely, like
  the other two.
- **Stages**: New → Contacted → Responded → **Demo booked** (a demo with Max is on the calendar) →
  **Signed up** (filled out the hauler signup form after the demo) → Paying client; a no goes to **Not
  interested**. Haulers with no reply after 7 days go to the Garbage AI call deck (`/garbage-ai/cold-call`).
- Every shared rule applies: one pitch per address across pipelines (an address Cold Outreach already pitched
  isn't pitched again), the do-not-email list, reply holds and both kill switches.

## What a reply does

What a reply does, in every pipeline (`src/lib/outreach/inbound.ts`):

- **Automatic replies** (out-of-office, vacation and "we got your message" autoresponders — recognised by
  the headers above, or by subjects like "Automatic reply:"/"Out of Office" and wording like "I am out of
  the office until…"; `src/lib/outreach/auto-mail.ts`) are added to the lead's History, marked as
  automatic, and change nothing else. The lead keeps its status, gets no reply time, isn't counted as
  replied, and still moves to the call deck after 7 days. A real reply later counts as usual; if a person
  did write one that was read as automatic, **Mark replied** records it. Automatic replies from addresses
  on no lead are filed away rather than listed on Replies.
- **Bounce notices** (from `mailer-daemon`/`postmaster`, with delivery-status fields, or a bounce subject
  plus 5.x.x codes) mark the failed recipient's latest send bounced, with the same rules as **Mark
  bounced**, and add the notice to the lead's History. One that doesn't name a recipient the app can match
  is listed on Replies, labelled as a bounce, with **Mark bounced** on the lead you pick instead of
  **Attach**.
- A lead that was emailed and is **Contacted**, **Cold call list** or **No phone number** moves to
  **Responded** and its reply time is set. That takes it off the call deck and counts it in the Stats
  page's reply rate, however late the reply arrives.
- **Stats** use the same definitions in every pipeline: **Replied** counts emailed leads a person replied
  to, excluding opt-outs and automatic replies; **Opted out** and **Automatic replies** are shown as their
  own figures; **We replied back** is measured against genuine replies only.
- A **Lost** or **Not interested** lead keeps its status, gets a reply time, and is flagged **Reply needs a
  look** in the lead list and on the lead page, until someone moves it or presses "Keep as …".
- A **plain no** ("Not interested", "No thanks", "We're all set", "Not for us") that asks nothing else is
  not an opt-out and is not flagged: a lead still being worked (Contacted, on the call deck) moves to
  **Lost** (Not interested in dataleadsell and Garbage AI) with the reply time set, and a lead that got further (Responded,
  a customer) is flagged **Reply needs a look** instead. The address is not put on the do-not-email list,
  but it gets no more email: a later send to it from any pipeline is refused as "already answered", and
  a New lead with the address is marked **Already answered**. If the reply was really interest, move the
  lead back to Responded — that is counted as a correction on Replies.
- A **thank-you only** reply ("Thanks", "Got it", "Received", "Thanks for reaching out, Jane") is recorded
  in the lead's History and changes nothing else: no reply time, no status change, no flag. The address gets
  no more email, as for a plain no. **Mark replied** counts it as a reply if it was one (also counted as a
  correction).
- A reply that may be asking to stop, a complaint ("wrong person", "who is this?", "spam"), a no mixed with
  interest, a hedge ("Thanks, I guess?"), one that puts it off ("Sounds great but not right now, maybe next
  quarter", "our budget is frozen till 2027", "check back in March"), one that only says it will be passed
  on or thought over ("Thank you, I will pass this on to the owner"), or one that shows no clear yes, no,
  question or request
  ([outreach-safety.md](outreach-safety.md) → "Replies") is flagged **Reply needs a look**, with the reason,
  instead of moving the lead to Responded. It gets no reply time, so it isn't counted in the reply rate, a
  Contacted lead stays off the call deck, and **nothing is emailed to the address** until the operator
  decides (**Mark replied**, **Mark opted out**, a move, or **Keep as Contacted**).
- A genuine opt-out goes on the do-not-email list with its evidence, whatever the lead's status, and a lead
  that was being worked (Contacted, Responded, on the call deck) moves to Lost (Not interested in
  dataleadsell and Garbage AI). Customers keep their status.
- The reply's new text is added to the lead's **History** (with any opt-out trigger or "needs a look"
  reason), never to its Notes, so automatically recorded replies and call notes can't push Notes past the
  5,000-character limit. Leads whose Notes already exceed it (from before this change) stay editable; their
  Notes just can't grow.
- A reply from an address that is on no lead (an assistant, a personal inbox, a forward) is kept with its
  text and listed on **Replies**, with a count next to "Replies" in the header (green when some read as
  interested). Replies read as interested are marked **Interested**, listed first and counted separately —
  they are usually a prospect writing from another address, so attach them to the right lead so it moves to
  Responded. **Attach** records it on the
  lead you pick exactly as if it had come from the lead's own address (for an opt-out, the lead's address
  also goes on the do-not-email list; a plain no closes the lead); **Dismiss** removes it from the list. An
  unmatched reply that needs a look, says no or only says thanks holds its address until it is attached,
  dismissed or marked opted out.
- **Is it working?** Every pipeline page and Replies show when the last reply arrived. Once a pitch is more
  than 48 hours old, the dashboard shows a red **Replies don't seem to be reaching the app** warning, and the
  header a **Replies not arriving** pill on every page, when no inbound message of any kind (reply,
  out-of-office or bounce) has ever been recorded, none in the last 7 days, or none since the last 20
  pitches older than 48 hours went out — usually a sign the Worker isn't reaching the app, so opt-outs
  aren't being recorded. Until it is fixed, read the sending inbox by hand, use **Mark opted out** and
  **Mark replied**, and pause sending if you can't keep up (`src/lib/outreach/reply-health.ts`).

The reply, its effects and a record of it are written in one database transaction, so a failure leaves
nothing half-recorded.

Replies that don't reach the route can be recorded by hand from the lead page with **Mark replied** (offered
for Contacted, Cold call list and No phone number leads that were emailed), **Mark bounced** (any lead that was
emailed, including after the stale-contacts move; a lead still being worked moves to Lost, a customer keeps
its status) or **Mark opted out**.

## Daily automation

`vercel.json` defines five Vercel Cron jobs. All routes need `Authorization: Bearer $CRON_SECRET`, which
Vercel sends automatically when `CRON_SECRET` is set.

| Route | Schedule (UTC) | Arizona time | What it does |
| --- | --- | --- | --- |
| `/api/cron/vault-daily` | `33 15 * * *` | 8:33 AM | Cold Outreach: searches one new city, saves businesses with a findable email, pitches them and any leads earlier daily runs found but didn't email |
| `/api/cron/dataleadsell-daily` | `3 16 * * *` | 9:03 AM | dataleadsell: the same run for real estate agents (the next agent city, Yelp term "real estate agent"), saving `AgentLead`s. **Off until turned on** on the dataleadsell page, with 10 agents per run by default so volume grows gradually. 30 minutes after Cold Outreach's, so the two never overlap |
| `/api/cron/garbage-ai-daily` | `0 15 * * *` | 8:00 AM | Garbage AI: the same run for haulers (Yelp term "garbage collection", never a city in Mountain High Disposal's service area). It leaves out haulers it never pitches before any lookup, saves `HaulerLead`s with a findable email and pitches them and any earlier daily runs found. If sending is ever held in code (`GARBAGE_AI_SENDING_HELD` in `src/lib/garbage-ai-config.ts`, currently off) it still finds haulers but emails nobody |
| `/api/cron/stale-contacts` | `0 13 * * *` | 6:00 AM | Every pipeline: contacted leads with no reply after 7 days move to the call deck (or the contactless list if there's no phone), each with a History entry; leads with an unresolved "needs a look" reply stay in Contacted |
| `/api/cron/daily-report` | `0 17 * * *` | 10:00 AM | Emails the owner one report (to `DAILY_REPORT_TO`, default t@thomasewright.com, from `DAILY_REPORT_FROM`, default the Cold Outreach sender) with a section per pipeline for the last 24 hours: the daily run's outcome and time-limit hits, leads added, sends, failed sends, bounces, replies, opt-outs, call-deck moves and the send backlog; turned-off pipelines get one line. Recorded as a `PipelineRun` (`all`/`daily-report`); a second call within 20 hours is skipped. Ignores the Settings pause (it says so in the report) but not `OUTBOUND_EMAIL_DISABLED` |

- **Settings.** Each pipeline page has its own **Daily automation** panel (stored in `PipelineSchedule` under `vault-pipeline`, `dataleadsell` and `garbage-ai`). With no saved row, Cold Outreach and Garbage AI run daily with 30 businesses per run and dataleadsell is off with 10 agents per run. The Cold Outreach page controls whether the daily run happens and how many **businesses it checks** for an address (1–50; one Yelp search returns at most 50). That is not the number emailed: typically only 15–25% of businesses yield a usable address, and discovery stops after 25 s. The panel shows the last run's actual numbers (businesses checked, addresses found, leads emailed), which are stored on the `PipelineRun` row. Changes apply to the next run.
- **Run time.** The time is fixed in `vercel.json`, so changing it needs a code change and a redeploy.
- **Run log.** Every run is recorded in `PipelineRun` (`pipeline` = `cold-outreach`, `dataleadsell` or `garbage-ai`), whether it succeeded, partly failed, failed or was skipped, along with the reasons. The last five runs appear on that pipeline's page. Settings → Connections watches all three daily runs (a run switched off on its page shows as Off), the call-deck move and the daily report.
  - While outbound email is paused (Settings) or switched off on the server (`OUTBOUND_EMAIL_DISABLED`), every daily run is recorded as **skipped** without searching Yelp, looking up addresses or sending.
  - The page warns when the last run is more than 26 hours old.
  - Every daily route returns JSON: `{ status, summary, errors }`. A failed run returns HTTP 500. If the run can't
    even be recorded (database unreachable) they return 503 with `{ ok: false, code: "db_unavailable" |
    "internal", error }`; the details are only in the server log.
  - A Yelp failure (down, rate-limited, key rejected) doesn't stop the run: the error is recorded, the city
    isn't used up, and the leads earlier runs found are still emailed. The run is **partial** if emails
    still went out and **failed** only if nothing could be done. A failed or partial run shows its first
    error in its row on the Cold Outreach page.
  - Otherwise only real send failures (the email service refused or dropped the send) make a run **partial** or
    **failed**. Leads the send rules skipped (address already pitched, opted out) and addresses the
    recipient's server refused are listed separately and the run still **succeeded**.
  - The stale-contacts job moves every due lead, and writes its History entry ("Moved to the call deck — no
    reply 7 days after the pitch sent Sep 17, 2026."), in one set-based statement per pipeline, so a backlog
    of thousands finishes in seconds.
  - A Yelp response that no longer has the expected shape is reported as "Yelp's response changed…" in the
    run log and Settings → Connections, rather than as an unexplained error or zero finds.
  - A run still marked running two minutes after it started was cut off before it could record its
    outcome, and shows as **Interrupted**.

Each run is time-budgeted to finish and record its outcome inside Vercel's 60-second function limit. Each
step starts only if its worst case fits: discovery (including the Yelp call) ends by 25 s — no lookup
starts with under 2 s left, and one in progress is cut off at 25 s — and a send starts only if its worst
case (20 s of SMTP timeouts) still ends by 55 s. Leads a daily run found but didn't email (out of
time, or the email service was unreachable and nothing was sent) stay New and are emailed by the next daily
run, oldest first, under all the usual send rules. Every pipeline page shows "N leads found but not yet
emailed" next to the bulk-send button.

