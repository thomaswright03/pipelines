import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { cache } from "react";
import { connection } from "next/server";
import SiteNav from "@/components/SiteNav";
import HeaderMenu from "@/components/HeaderMenu";
import ThemeToggle from "@/components/ThemeToggle";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { getAppSettings } from "@/lib/outreach/settings";
import { outboundDisabledByEnvironment } from "@/lib/outbound-switch";
import { describeMailDestination } from "@/lib/mail-transport-kind";
import { logError } from "@/lib/log";
import { countUnmatchedInterested, countUnmatchedReplies } from "@/lib/outreach/inbound";
import { getReplyHealth } from "@/lib/outreach/reply-health";
import { databaseReachable } from "@/lib/db-health";
import DatabaseUnavailable from "@/components/DatabaseUnavailable";
import PageTransition from "@/components/motion/PageTransition";
import RouteProgress from "@/components/motion/RouteProgress";
import PointerLight from "@/components/motion/PointerLight";
// The display serif, bundled with the app (no font CDN): titles, names and big numbers (globals.css).
import "@fontsource-variable/fraunces/opsz.css";
import "@fontsource-variable/fraunces/opsz-italic.css";
import "./globals.css";
import "./motion.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Pages set their own title ("Settings", a lead's name…); this is the suffix and the fallback.
  title: { default: "Cold email outreach", template: "%s · Outreach" },
  description: "Wright AI Solutions' cold email outreach: finds leads, emails each one pitch, tracks replies, and lists who to call",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col text-zinc-900 dark:text-zinc-100">
        <RouteProgress />
        <PointerLight />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-indigo-800 focus:shadow focus:ring-2 focus:ring-indigo-600 dark:focus:bg-zinc-900 dark:focus:text-indigo-200 dark:focus:ring-indigo-400"
        >
          Skip to content
        </a>
        <header className="z-10 sm:sticky sm:top-0 border-b border-zinc-200/70 bg-white/80 backdrop-blur-md dark:border-zinc-800/70 dark:bg-zinc-950/80">
          {/* One row from lg up, across the full width: logo, nav, theme, then the status pills, which shrink (full text on hover) rather than wrap — the mail badge first. */}
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 px-4 py-2 sm:gap-x-4 sm:gap-y-2 sm:px-6 sm:py-3 lg:max-w-none lg:flex-nowrap lg:px-8">
            <Link
              href="/"
              aria-label="Outreach — dashboard"
              className="flex min-h-11 shrink-0 items-center gap-2 text-lg font-semibold tracking-tight sm:min-h-8"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-bold text-white shadow-sm shadow-indigo-600/30">
                O
              </span>
              {/* The wordmark gives way to the nav and status pills where the one-row header is tight (lg up to 2xl). */}
              <span className="hidden sm:inline lg:hidden 2xl:inline">Outreach</span>
            </Link>
            {/* Always visible, on a phone too (in one word each, so the header stays one row): paused, replies not arriving, and where "sent" mail goes. */}
            <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:order-last sm:gap-2">
              <OutboundStatus />
            </div>
            <HeaderMenu>
              <NavWithCounts />
              <ThemeToggle />
              <HeaderStatusList />
            </HeaderMenu>
          </div>
        </header>
        <main id="main" className="mx-auto w-full min-w-0 max-w-5xl flex-1 px-4 pb-8 pt-4 sm:px-6 sm:pt-8">
          <PageTransition>
            <UnlessDatabaseDown>{children}</UnlessDatabaseDown>
          </PageTransition>
        </main>
        <footer className="border-t border-zinc-200/70 px-6 py-4 text-center text-xs text-zinc-600 dark:border-zinc-800/70 dark:text-zinc-400">
          © {new Date().getFullYear()} Wright AI Solutions LLC ·{" "}
          <Link href="/help" className="underline underline-offset-2">
            Operator guide
          </Link>
        </footer>
      </body>
    </html>
  );
}

/**
 * The page itself, or — when the database can't be reached — a plain
 * explanation of the outage in its place, so the page never renders (and
 * fails) against a database that isn't there. error.tsx covers the rarer
 * case of the database dropping mid-render.
 */
async function UnlessDatabaseDown({ children }: { children: React.ReactNode }) {
  await connection();
  if (!(await databaseReachable())) return <DatabaseUnavailable />;
  return children;
}

/** The main nav, with the number of replies waiting to be matched to a lead. */
async function NavWithCounts() {
  await connection();
  let unmatched = 0;
  let interested = 0;
  try {
    [unmatched, interested] = await Promise.all([countUnmatchedReplies(), countUnmatchedInterested()]);
  } catch (err) {
    logError("layout.unmatchedReplies", err);
  }
  return <SiteNav unmatchedReplies={unmatched} interestedReplies={interested} />;
}

type HeaderStatus = {
  mail: ReturnType<typeof describeMailDestination>;
  /** Stopped by OUTBOUND_EMAIL_DISABLED (needs no database, so it shows even when that is down). */
  byEnvironment: boolean;
  /** Null when the database couldn't be read. */
  paused: boolean | null;
  repliesMissing: boolean;
};

/** What the header's status pills say, read once per request (the header shows it twice: as pills, and in full in the phone menu). */
const loadHeaderStatus = cache(async (): Promise<HeaderStatus> => {
  // Read per request, never baked into a prerendered page.
  await connection();
  const mail = describeMailDestination();
  const byEnvironment = outboundDisabledByEnvironment();
  let paused: boolean | null = byEnvironment || null;
  let repliesMissing = false;
  try {
    if (!byEnvironment) paused = (await getAppSettings()).outboundPaused;
    repliesMissing = (await getReplyHealth()).warning;
  } catch (err) {
    logError("layout.settings", err);
  }
  return { mail, byEnvironment, paused, repliesMissing };
});

type Pill = {
  key: string;
  href: string | null;
  /** The pill's text from `sm` up (truncated with a tooltip if it must be). */
  full: string;
  /** Its text on a phone, where the header must stay one row. */
  short: string;
  /** The link's accessible name. */
  label: string;
  /** What it means, in a sentence: the tooltip, and the line in the phone menu. */
  detail: string;
  tone: "red" | "amber" | "sky";
  dot: boolean;
};

function headerPills({ mail, byEnvironment, paused, repliesMissing }: HeaderStatus): Pill[] {
  const pills: Pill[] = [];
  if (mail.badge) {
    pills.push({
      key: "mail",
      href: "/settings#connections-heading",
      full: mail.badge,
      short: mail.shortBadge ?? mail.badge,
      label: mail.badge,
      detail: mail.description,
      tone: mail.delivers ? "amber" : "sky",
      dot: false,
    });
  }
  if (repliesMissing) {
    pills.push({
      key: "replies",
      href: "/replies",
      full: "Replies not arriving",
      short: "Replies",
      label: "Replies not arriving — see Unmatched replies",
      detail: "Replies (opt-outs among them) don't seem to be reaching the app — see the Unmatched replies page.",
      tone: "amber",
      dot: true,
    });
  }
  if (paused) {
    pills.push({
      key: "paused",
      href: "/settings",
      full: byEnvironment ? "Sending off (server)" : "Sending paused",
      short: byEnvironment ? "Off" : "Paused",
      label: byEnvironment ? "Outbound email switched off by your hosting" : "Outbound email paused",
      detail: byEnvironment
        ? "Sending is switched off by whoever manages the app's hosting; nothing is emailed. Ask your developer to turn it back on."
        : "Outbound email is paused in Settings; nothing is emailed until it is resumed.",
      tone: "red",
      dot: true,
    });
  }
  if (paused === null) {
    pills.push({
      key: "database",
      href: null,
      full: "Can't reach the database",
      short: "No database",
      label: "Can't reach the database",
      detail: "The database can't be reached, so pages can't load or save anything until it is back.",
      tone: "amber",
      dot: false,
    });
  }
  return pills;
}

const PILL_TONE: Record<Pill["tone"], { pill: string; dot: string }> = {
  red: { pill: "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200", dot: "bg-red-600" },
  amber: { pill: "bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200", dot: "bg-amber-600" },
  sky: { pill: "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-200", dot: "bg-sky-600" },
};

/**
 * Header pills that are always visible: outbound email paused, replies not
 * arriving, and (when not using the live mail service) where "sent" mail
 * actually goes. Where the header row is tight — a phone, and from lg (where
 * the nav joins the row) up to 1400px — each shows a one-word form; the full
 * text is in the phone menu (HeaderStatusList) and, everywhere, in a
 * tooltip on hover and on keyboard focus. Elsewhere the full text shows.
 */
async function OutboundStatus() {
  const pills = headerPills(await loadHeaderStatus());
  return (
    <>
      {pills.map((pill) => {
        const tone = PILL_TONE[pill.tone];
        const className = `group relative inline-flex min-h-11 min-w-0 shrink items-center gap-1.5 rounded-full px-2 py-1 text-xs font-semibold sm:min-h-7 sm:px-2.5 ${
          pill.key === "mail" ? "shrink-[4] font-medium" : ""
        } ${tone.pill}`;
        const content = (
          <>
            {pill.dot && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} aria-hidden />}
            {/* The one-word form where the row is tight: a phone, and from lg (one row with the nav) until 1400px. */}
            <span className="whitespace-nowrap sm:hidden lg:inline wide:hidden">{pill.short}</span>
            <span
              className={`hidden truncate sm:inline lg:hidden wide:inline ${pill.key === "mail" ? "max-w-[15rem] wide:max-w-none" : ""}`}
            >
              {pill.full}
            </span>
            <span
              role="tooltip"
              className="pointer-events-none invisible absolute right-0 top-full z-20 mt-1 w-max max-w-xs rounded-md bg-zinc-900 px-2 py-1 text-xs font-normal text-white shadow-lg group-hover:visible group-focus-visible:visible dark:bg-zinc-100 dark:text-zinc-900"
            >
              {pill.detail}
            </span>
          </>
        );
        return pill.href ? (
          <Link key={pill.key} href={pill.href} aria-label={pill.label} className={className}>
            {content}
          </Link>
        ) : (
          <span key={pill.key} role="status" className={className}>
            {content}
          </span>
        );
      })}
    </>
  );
}

/** The header's statuses in full, inside the phone menu (the pills themselves are one word there). */
async function HeaderStatusList() {
  const pills = headerPills(await loadHeaderStatus());
  if (pills.length === 0) return null;
  return (
    <ul aria-label="Status" className="flex flex-col gap-1 border-t border-zinc-200 pt-2 text-sm sm:hidden dark:border-zinc-800">
      {pills.map((pill) => (
        <li key={pill.key} className="flex items-start gap-2">
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${PILL_TONE[pill.tone].dot}`} aria-hidden />
          <span>
            <strong className="font-medium">{pill.full}.</strong> {pill.detail}
          </span>
        </li>
      ))}
    </ul>
  );
}
