import type { Metadata } from "next";
import Link from "next/link";
import {
  DATALEADSELL_DAILY_RUN_TIME_LABEL,
  GARBAGE_AI_DAILY_RUN_TIME_LABEL,
  VAULT_DAILY_RUN_TIME_LABEL,
} from "@/lib/pipeline-schedule-rules";
import { GARBAGE_AI_DEMO_HOST, GARBAGE_AI_REFERENCE_CUSTOMER } from "@/lib/garbage-ai-config";

export const metadata: Metadata = { title: "Operator guide" };

// The one-page runbook for whoever runs the pipelines day to day. Written
// for the operator, not the developer: button names are the ones on screen.
// Keep it in step with the UI when a button or page changes.

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="card flex flex-col gap-2 p-4 text-sm">
      <h2 id={id} className="text-base font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

const link = "text-indigo-700 underline underline-offset-2 dark:text-indigo-300";

// Every word the screens use that a newcomer might not know, in one place.
const GLOSSARY: [string, string][] = [
  ["Pitch", "The one outreach email each address gets. An address is never pitched twice."],
  [
    "Lead / agent / hauler",
    "Who a pipeline may email: a local business (Cold Outreach), a real-estate agent (dataleadsell.com) or a waste hauler (Garbage AI).",
  ],
  [
    "Hauler",
    "A trash, recycling or dumpster-rental company. Garbage AI pitches haulers an AI that texts back their online leads, with a demo.",
  ],
  [
    "Never emailed (Garbage AI)",
    `A hauler Garbage AI never pitches: a current client, a national hauler, a city or county department, or one in ${GARBAGE_AI_REFERENCE_CUSTOMER}'s Colorado service area. Its row and page say why.`,
  ],
  [
    "Demo booked / Signed up",
    `Garbage AI stages: a demo with ${GARBAGE_AI_DEMO_HOST} is booked; the hauler filled out the signup form after it.`,
  ],
  ["Call deck", "Leads that didn't reply within a week of their pitch and have a phone number, shown one card at a time to call."],
  ["No phone number", "Leads that didn't reply within a week and have no number to call (also called contactless)."],
  ["Reply needs a look", "The app couldn't be sure what a reply means. Nothing is emailed to that address until you decide."],
  ["Plain no", "A reply that only says no (\u201cnot interested\u201d). The lead is closed and the address isn't emailed again."],
  ["Thank-you only", "A reply that only says thanks or got it. Noted on the lead; the address isn't emailed again."],
  ["Do-not-email list", "Addresses that asked not to be emailed. No pipeline ever emails them (see Settings)."],
  ["Won't be auto-sent", "A New lead the bulk send and daily run skip; its page says why."],
  ["Bounced", "The email couldn't be delivered to the address."],
  ["Email version", "Which wording of the pitch was sent; a new version starts whenever the wording changes (Stats)."],
  [
    "Found address / rules version",
    "An address the lookup found on the lead's website, and which version of its rules accepted it (Replies).",
  ],
  ["ADRE", "The Arizona Department of Real Estate. Its public license roster is where Maricopa agents are imported from."],
  ["Paused / Sending off (server)", "Outbound email is stopped, by the Settings switch or by the server setting OUTBOUND_EMAIL_DISABLED."],
];

export default function HelpPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="accent-text text-2xl font-bold tracking-tight">Operator guide</h1>
        <p className="mt-1 text-sm muted">The everyday jobs, and what to do when something looks wrong.</p>
      </div>

      <Section id="stop" title="Emergency stop: pause all email">
        <p>
          Open{" "}
          <Link href="/settings" className={link}>
            Settings
          </Link>{" "}
          and press <strong>Pause all outbound email</strong>. Nothing is sent from any pipeline — single sends, bulk sends or a daily run —
          until you press <strong>Resume outbound email</strong>, and the daily runs don&apos;t search for new leads meanwhile either. It
          takes effect on the very next email, even in the middle of a bulk send. A red <em>Sending paused</em> label shows at the top of
          every page while it&apos;s on.
        </p>
        <p>
          <strong>If the app itself won&apos;t load</strong> (or you can&apos;t sign in), stop sending from the hosting dashboard instead:
          in Vercel, open the project → <em>Settings</em> → <em>Environment Variables</em>, add <code>OUTBOUND_EMAIL_DISABLED</code> with
          the value <code>1</code> for Production, then redeploy the latest deployment. It takes effect when the redeploy finishes — usually
          1–3 minutes — and until then email can still go out: close any tab that is running a bulk send. Reload the app to check: the
          header shows <em>Sending off (server)</em> (<em>Off</em> on a phone) once it is in force. Delete the variable and redeploy to turn
          sending back on. The full steps, including stopping the daily runs at once from Vercel&apos;s Cron Jobs settings, are in the
          deployment guide&apos;s &ldquo;Emergency stop&rdquo;.
        </p>
      </Section>

      <Section id="daily" title="Every day">
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            <strong>Check Connections.</strong> On{" "}
            <Link href="/settings#connections-heading" className={link}>
              Settings
            </Link>
            , every row should say <em>Working</em> (or <em>Off</em> for a daily run you switched off). See &ldquo;Reading
            Connections&rdquo; below for anything else.
          </li>
          <li>
            <strong>Match stray replies.</strong> A number next to{" "}
            <Link href="/replies" className={link}>
              Unmatched replies
            </Link>{" "}
            in the menu means replies came from an address that isn&apos;t on any lead (an assistant, a personal inbox). For each one,
            search for the lead it belongs to and press <strong>Attach</strong> — or <strong>Dismiss</strong> if it belongs to nobody.
            Replies from a lead&apos;s own address never wait there: they are recorded on the lead and listed on that pipeline&apos;s{" "}
            <em>Sent &amp; replies</em> tab, with every email it sent and every one that failed.
          </li>
          <li>
            <strong>Look at flagged replies — every day.</strong> The app only acts on a reply by itself when it is sure:
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              <li>a plain &ldquo;STOP&rdquo; or &ldquo;remove me&rdquo; goes on the do-not-email list;</li>
              <li>a clear &ldquo;yes, call me&rdquo; or a question moves the lead to Responded;</li>
              <li>
                a plain &ldquo;not interested&rdquo; or &ldquo;no thanks&rdquo; closes the lead (Lost in Cold Outreach, Not interested in
                the other two) — it isn&apos;t put on the do-not-email list, but nothing more is emailed to that address;
              </li>
              <li>
                a reply that only says &ldquo;Thanks&rdquo;, &ldquo;Got it&rdquo; or &ldquo;Received&rdquo; is noted in the lead&apos;s
                history and changes nothing else — nothing more is emailed to that address, and the lead still goes to the call deck after a
                week.
              </li>
            </ul>
            Everything else is marked <em>Reply needs a look</em> in the lead list (for example &ldquo;who is this?&rdquo;, &ldquo;please no
            further contact&rdquo;, &ldquo;maybe&rdquo;, &ldquo;sounds great, but not until next quarter&rdquo;, &ldquo;I&apos;ll pass this
            on to the owner&rdquo;, or a reply in Spanish). A reply that puts you off isn&apos;t counted as interest: decide whether to call
            them later. Nothing is emailed to that address until you decide, so a reply asking to stop is never ignored — but it waits for
            you. Open the lead: the reply is shown with the reason, and <strong>Mark opted out</strong>, <strong>Mark replied</strong> and{" "}
            <strong>Keep as …</strong> are right under it. If the app closed a lead on a &ldquo;no&rdquo; that wasn&apos;t one, move it back
            to Responded; if a &ldquo;thanks&rdquo; meant more, press <strong>Mark replied</strong>. The Unmatched replies page counts these
            corrections.
          </li>
          <li>
            <strong>Work the call deck.</strong> Leads that didn&apos;t reply within a week move to the call deck (the <em>Call deck</em>{" "}
            link on each pipeline page). Record each call&apos;s outcome; the deck remembers your place if you refresh.
          </li>
          <li>
            <strong>Glance at the daily runs.</strong> Each pipeline runs several times a day and sends until its emails-per-day number is
            reached:{" "}
            <Link href="/garbage-ai" className={link}>
              Garbage AI
            </Link>{" "}
            {GARBAGE_AI_DAILY_RUN_TIME_LABEL},{" "}
            <Link href="/vault-pipeline" className={link}>
              Cold Outreach
            </Link>{" "}
            {VAULT_DAILY_RUN_TIME_LABEL} and{" "}
            <Link href="/dataleadsell" className={link}>
              dataleadsell.com
            </Link>{" "}
            {DATALEADSELL_DAILY_RUN_TIME_LABEL} (once its daily run is turned on). On each page, <em>Recent runs</em> says what the last run
            found and emailed. A red line under a run says why it failed.
          </li>
        </ol>
      </Section>

      <Section id="by-hand" title="When a reply didn't show up in the app">
        <p>
          If replies stop arriving altogether, every page shows <em>Replies not arriving</em> at the top and the dashboard explains it.
          Until your developer fixes reply forwarding, read the sending inbox yourself every day.
        </p>
        <p>
          If someone replied to your inbox but their lead doesn&apos;t show it, open the lead and press <strong>Mark replied</strong>. If
          they asked not to be emailed, press <strong>Mark opted out</strong> instead — the address goes on the do-not-email list and no
          pipeline will email it again. Then tell your developer that replies aren&apos;t reaching the app.
        </p>
      </Section>

      <Section id="held-back" title="Leads that are held back">
        <p>
          A New lead marked <em>Won&apos;t be auto-sent</em> in the list isn&apos;t sent by the bulk send or the daily run. The warning on
          its page says why: the address was already pitched by another lead, it&apos;s on the do-not-email list, it already answered a
          pitch with a no or a thank-you, a mail server refused it, or the address needs checking. For &ldquo;needs checking&rdquo;, open
          the website shown on the lead, make sure the address belongs to that business or agent, then press{" "}
          <strong>Address checked — allow sending</strong> (or use <strong>Edit details</strong> to fix the address).
        </p>
      </Section>

      <Section id="garbage-ai" title="Garbage AI">
        <p>
          <Link href="/garbage-ai" className={link}>
            Garbage AI
          </Link>{" "}
          pitches trash, recycling and dumpster-rental <strong>haulers</strong> an AI that texts back every online lead they get, day or
          night, and points them to a short video and signup form or a 15-minute walkthrough. Its runs, {GARBAGE_AI_DAILY_RUN_TIME_LABEL},
          search Yelp in a new US city each, find each hauler&apos;s address on its own website and email the ones they found. It follows
          every rule the other pipelines do: one pitch per address, the do-not-email list, replies that need a look, and the emergency stop.
        </p>
        <p>
          <strong>Who it never emails.</strong> These haulers are left out of every search, and if one is added by hand its page shows{" "}
          <em>Never emailed</em> with the reason instead of a Send button:
        </p>
        <ul className="list-disc space-y-0.5 pl-5">
          <li>current clients ({GARBAGE_AI_REFERENCE_CUSTOMER}, Eastern Waste &amp; Recycling, Garden State Bin Cleaning);</li>
          <li>national and large regional haulers (WM, Republic Services, Waste Connections, GFL and the like);</li>
          <li>city and county sanitation or public-works departments;</li>
          <li>
            any hauler in {GARBAGE_AI_REFERENCE_CUSTOMER}&apos;s service area (Denver metro and Northern Colorado) — those cities are never
            searched either.
          </li>
        </ul>
        <p>
          <strong>Stages.</strong> After <em>Responded</em>, move a hauler to <em>Demo booked</em> when a demo is on the calendar, then{" "}
          <em>Signed up</em> once they fill out the signup form, and <em>Paying client</em> when they pay. A &ldquo;no&rdquo; goes to{" "}
          <em>Not interested</em>. Haulers who don&apos;t reply within a week go to its call deck, like the other pipelines.
        </p>
      </Section>

      <Section id="connections" title="Reading Connections">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Working</strong> — it has actually worked recently (a send, a search, a reply, or a test).
          </li>
          <li>
            <strong>Not confirmed yet</strong> — it&apos;s set up but nothing has proved it works. For email and Yelp, press{" "}
            <strong>Test connection</strong>: the email test logs in without sending anything, and the Yelp test runs one tiny search. For
            replies, it turns green when the first reply arrives; mark replies by hand until then.
          </li>
          <li>
            <strong>Check the reply loop</strong> (under the list) proves sending and replies together: enter an address you can read, press{" "}
            <strong>Send test pitch</strong>, reply to the email, and reload Settings — it shows <em>Passed</em> once your reply is
            recorded. Use a new address each time (you+check2@… works), and delete the &ldquo;Reply check&rdquo; lead afterwards.
          </li>
          <li>
            <strong>Check</strong> — something needs a look; the <em>Next step</em> line says what.
          </li>
          <li>
            <strong>Not working</strong> — follow the <em>Next step</em>; a failed scheduled job links the page that shows why. When it says
            to tell your developer, send them the whole row as it appears on screen.
          </li>
          <li>
            <strong>Off</strong> — a pipeline&apos;s daily run that is switched off on its page. Nothing is wrong; it neither searches nor
            sends until you turn it on.
          </li>
        </ul>
      </Section>

      <Section id="glossary" title="Glossary">
        <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[12rem_1fr]">
          {GLOSSARY.map(([term, meaning]) => (
            <div key={term} className="contents">
              <dt className="font-semibold">{term}</dt>
              <dd className="mb-1 sm:mb-0">{meaning}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section id="contact" title="Who to contact">
        <p>
          For anything on this page that says &ldquo;tell your developer&rdquo;, contact whoever maintains the app (at the time of writing,
          Thomas Wright). Include what the screen says and when you saw it. Pausing outbound email is always safe while you wait.
        </p>
      </Section>
    </div>
  );
}
