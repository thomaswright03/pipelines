import type { Metadata } from "next";
import Link from "next/link";
import {
  getMailbox,
  MAILBOX_ADDRESS,
  MAILBOX_PAGE_SIZE,
  parseMailboxFilter,
  parseMailboxPage,
  type MailboxFilter,
  type MailboxMessage,
} from "@/lib/outreach/mailbox";
import { formatDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Inbox" };

const FILTER_LABEL: Record<MailboxFilter, string> = {
  all: "All",
  people: "From people",
  automatic: "Automatic",
  bounces: "Bounces",
};

const PILL = "inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium";
const GREY = "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200";

const VERDICT: Record<string, { label: string; tone: string }> = {
  positive: { label: "Interested", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" },
  needs_look: { label: "Needs a look", tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" },
  declined: { label: "Said no", tone: GREY },
  acknowledged: { label: "Thanks only", tone: GREY },
  opt_out: { label: "Opted out", tone: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200" },
};

const RESOLUTION: Record<string, string> = {
  dismissed: "Dismissed",
  opted_out: "Marked opted out",
  auto_reply: "Automatic, no lead",
};

function kindPill(m: MailboxMessage) {
  if (m.kind === "bounce") return { label: "Bounce", tone: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200" };
  if (m.kind === "auto_reply") return { label: "Automatic", tone: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200" };
  return m.verdict ? VERDICT[m.verdict] : undefined;
}

function href(filter: MailboxFilter, page = 1) {
  const params = new URLSearchParams();
  if (filter !== "all") params.set("filter", filter);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/inbox?${query}` : "/inbox";
}

export default async function InboxPage({ searchParams }: PageProps<"/inbox">) {
  const params = await searchParams;
  const mailbox = await getMailbox(parseMailboxFilter(params.filter), parseMailboxPage(params.page));
  const { filter, page, counts, messages } = mailbox;
  const total = counts[filter];
  const pages = Math.max(1, Math.ceil(total / MAILBOX_PAGE_SIZE));
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="accent-text text-2xl font-bold tracking-tight">Inbox</h1>
        <p className="mt-1 text-sm muted">
          Everything emailed to <strong>{MAILBOX_ADDRESS}</strong>, newest first: replies from leads, replies from other addresses,
          out-of-office and other automatic mail, bounce notices, and messages from services such as sign-in codes. Read-only — answer a
          lead from its pipeline&apos;s <em>Sent &amp; replies</em> tab, and match a reply from an unknown address on{" "}
          <Link href="/replies" className="font-medium text-indigo-700 underline underline-offset-2 dark:text-indigo-300">
            Unmatched replies
          </Link>
          .
        </p>
        <p className="mt-1 text-xs muted">
          Long messages are cut to their first 2,000 characters, and quoted earlier messages and signatures are left out.
        </p>
      </div>

      <nav aria-label="Inbox filters" className="flex flex-wrap gap-1.5">
        {(Object.keys(FILTER_LABEL) as MailboxFilter[]).map((f) => (
          <Link
            key={f}
            href={href(f)}
            aria-current={f === filter ? "page" : undefined}
            className={f === filter ? "tab-active" : "tab-inactive"}
          >
            {FILTER_LABEL[f]} ({counts[f].toLocaleString("en-US")})
          </Link>
        ))}
      </nav>

      {messages.length === 0 ? (
        <p className="card p-4 text-sm muted">{page > 1 ? "No more messages." : "Nothing here yet."}</p>
      ) : (
        <ul className="card divide-y divide-zinc-200 dark:divide-zinc-800">
          {messages.map((m) => {
            const pill = kindPill(m);
            return (
              <li key={m.id} className="flex flex-col gap-1 p-3 sm:flex-row sm:items-start sm:gap-4">
                <div className="min-w-0 sm:w-64 sm:shrink-0">
                  <p className="truncate font-medium">{m.fromEmail}</p>
                  {m.leads.length > 0 ? (
                    <p className="flex flex-wrap gap-x-2 text-xs">
                      {m.leads.map((lead) => (
                        <Link key={lead.href} href={lead.href} className="underline underline-offset-2 muted">
                          {lead.label} lead
                        </Link>
                      ))}
                    </p>
                  ) : (
                    <p className="text-xs muted">Not on any lead</p>
                  )}
                </div>
                <details className="min-w-0 flex-1 text-sm">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2">
                    {pill && <span className={`${PILL} ${pill.tone}`}>{pill.label}</span>}
                    {m.optedOut && m.verdict !== "opt_out" && <span className={`${PILL} ${VERDICT.opt_out!.tone}`}>Opted out</span>}
                    {m.resolution && RESOLUTION[m.resolution] && <span className={`${PILL} ${GREY}`}>{RESOLUTION[m.resolution]}</span>}
                    <span className="min-w-0 truncate font-medium">{m.subject || <span className="muted">(no subject)</span>}</span>
                    {m.text && <span className="line-clamp-1 w-full break-words muted">{m.text}</span>}
                  </summary>
                  <div className="mt-2 flex flex-col gap-1">
                    {m.text ? <p className="whitespace-pre-line break-words">{m.text}</p> : <p className="muted">(no text recorded)</p>}
                    {m.kindReason && <p className="text-xs muted">Why it was filed this way: {m.kindReason}</p>}
                  </div>
                </details>
                <time dateTime={m.receivedAt.toISOString()} className="whitespace-nowrap text-xs muted">
                  {formatDateTime(m.receivedAt)}
                </time>
              </li>
            );
          })}
        </ul>
      )}

      {pages > 1 && (
        <nav aria-label="Inbox pages" className="flex items-center gap-3 text-sm">
          {page > 1 && (
            <Link href={href(filter, page - 1)} className="underline underline-offset-2">
              ← Newer
            </Link>
          )}
          <span className="muted">
            Page {page} of {pages}
          </span>
          {page < pages && (
            <Link href={href(filter, page + 1)} className="underline underline-offset-2">
              Older →
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
