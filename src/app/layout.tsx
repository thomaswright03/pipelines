import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { connection } from "next/server";
import SiteNav from "@/components/SiteNav";
import ThemeToggle from "@/components/ThemeToggle";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { getAppSettings } from "@/lib/outreach/settings";
import { describeMailDestination } from "@/lib/mail-transport-kind";
import { logError } from "@/lib/log";
import { countUnmatchedReplies } from "@/lib/outreach/inbound";
import { databaseReachable } from "@/lib/db-health";
import DatabaseUnavailable from "@/components/DatabaseUnavailable";
import "./globals.css";

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
  title: { default: "Pipelines", template: "%s · Pipelines" },
  description: "Dashboard for Wright AI Solutions' email outreach pipelines",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col text-zinc-900 dark:text-zinc-100">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:shadow"
        >
          Skip to content
        </a>
        <header className="z-10 sm:sticky sm:top-0 border-b border-zinc-200/70 bg-white/80 backdrop-blur-md dark:border-zinc-800/70 dark:bg-zinc-950/80">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
            <Link href="/" className="flex min-h-11 items-center gap-2 text-lg font-semibold tracking-tight sm:min-h-8">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-bold text-white shadow-sm shadow-indigo-600/30">
                P
              </span>
              <span className="hidden sm:inline">Pipelines</span>
            </Link>
            <NavWithCounts />
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <OutboundStatus />
              <ThemeToggle />
            </div>
          </div>
        </header>
        <main id="main" className="mx-auto w-full min-w-0 max-w-5xl flex-1 px-4 py-8 sm:px-6">
          <UnlessDatabaseDown>{children}</UnlessDatabaseDown>
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
  try {
    unmatched = await countUnmatchedReplies();
  } catch (err) {
    logError("layout.unmatchedReplies", err);
  }
  return <SiteNav unmatchedReplies={unmatched} />;
}

/**
 * Header pills that are always visible: outbound email paused, and (when
 * not using the live mail service) where "sent" mail actually goes.
 */
async function OutboundStatus() {
  // Read per request, never baked into a prerendered page.
  await connection();
  const mail = describeMailDestination();
  let paused: boolean | null = null;
  try {
    paused = (await getAppSettings()).outboundPaused;
  } catch (err) {
    logError("layout.settings", err);
  }
  return (
    <>
      {mail.badge && (
        <span
          className={
            mail.delivers
              ? "rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
              : "rounded-full bg-sky-100 px-2.5 py-1 text-xs font-medium text-sky-900 dark:bg-sky-900/40 dark:text-sky-200"
          }
        >
          {mail.badge}
        </span>
      )}
      {paused && (
        <Link
          href="/settings"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-800 sm:min-h-7 dark:bg-red-900/50 dark:text-red-200"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-red-600" aria-hidden />
          Outbound email paused
        </Link>
      )}
      {paused === null && (
        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
          Can&apos;t reach the database
        </span>
      )}
    </>
  );
}
