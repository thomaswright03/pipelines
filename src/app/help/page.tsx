import type { Metadata } from "next";
import Link from "next/link";

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
          and press <strong>Pause all outbound email</strong>. Nothing is sent from either pipeline — single sends, bulk sends or the daily
          run — until you press <strong>Resume outbound email</strong>. It takes effect on the very next email, even in the middle of a bulk
          send. A red <em>Outbound email paused</em> label shows at the top of every page while it&apos;s on.
        </p>
      </Section>

      <Section id="daily" title="Every day">
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            <strong>Check Connections.</strong> On{" "}
            <Link href="/settings#connections-heading" className={link}>
              Settings
            </Link>
            , every row should say <em>Working</em>. See &ldquo;Reading Connections&rdquo; below for anything else.
          </li>
          <li>
            <strong>Match stray replies.</strong> A number next to{" "}
            <Link href="/replies" className={link}>
              Replies
            </Link>{" "}
            in the menu means replies came from an address that isn&apos;t on any lead (an assistant, a personal inbox). For each one,
            search for the lead it belongs to and press <strong>Attach</strong> — or <strong>Dismiss</strong> if it belongs to nobody.
          </li>
          <li>
            <strong>Look at flagged replies.</strong> In each pipeline&apos;s list, leads marked <em>Reply needs a look</em> got a reply
            that might be a &ldquo;no&rdquo; or a request to stop (for example &ldquo;not interested&rdquo;, or a reply in Spanish). Open
            the lead, read the reply in its history, then either press <strong>Mark opted out</strong> if they asked not to be emailed, or
            move the lead to the right stage.
          </li>
          <li>
            <strong>Work the call deck.</strong> Leads that didn&apos;t reply within a week move to the call deck (the <em>Call deck</em>{" "}
            link on each pipeline page). Record each call&apos;s outcome; the deck remembers your place if you refresh.
          </li>
          <li>
            <strong>Glance at the daily run.</strong> On{" "}
            <Link href="/vault-pipeline" className={link}>
              Cold Outreach
            </Link>
            , <em>Recent runs</em> says what the last run found and emailed. A red line under a run says why it failed.
          </li>
        </ol>
      </Section>

      <Section id="by-hand" title="When a reply didn't show up in the app">
        <p>
          If someone replied to your inbox but their lead doesn&apos;t show it, open the lead and press <strong>Mark replied</strong>. If
          they asked not to be emailed, press <strong>Mark opted out</strong> instead — the address goes on the do-not-email list and
          neither pipeline will email it again. Then tell your developer that replies aren&apos;t reaching the app.
        </p>
      </Section>

      <Section id="held-back" title="Leads that are held back">
        <p>
          A New lead marked <em>Won&apos;t be auto-sent</em> in the list isn&apos;t sent by the bulk send or the daily run. The warning on
          its page says why: the address was already pitched by another lead, it&apos;s on the do-not-email list, or the address needs
          checking. For &ldquo;needs checking&rdquo;, open the website shown on the lead, make sure the address belongs to that business or
          agent, then press <strong>Address checked — allow sending</strong> (or use <strong>Edit details</strong> to fix the address).
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
            <strong>Check</strong> — something needs a look; the <em>Next step</em> line says what.
          </li>
          <li>
            <strong>Not working</strong> — follow the <em>Next step</em>. When it says to tell your developer, send them the whole row as it
            appears on screen.
          </li>
        </ul>
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
