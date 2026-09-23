import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import SiteNav from "@/components/SiteNav";
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
  title: "Pipelines",
  description: "Local host for email/SMS marketing pipelines",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col text-zinc-900 dark:text-zinc-100">
        <header className="sticky top-0 z-10 border-b border-zinc-200/70 bg-white/70 backdrop-blur-md dark:border-zinc-800/70 dark:bg-zinc-950/70">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3.5">
            <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-bold text-white shadow-sm shadow-indigo-600/30">
                P
              </span>
              <span className="hidden sm:inline">Pipelines</span>
            </Link>
            <SiteNav />
          </div>
        </header>
        <main className="mx-auto w-full min-w-0 max-w-5xl flex-1 px-6 py-8">{children}</main>
        <footer className="border-t border-zinc-200/70 px-6 py-4 text-center text-xs text-zinc-400 dark:border-zinc-800/70 dark:text-zinc-500">
          © {new Date().getFullYear()} Wright AI Solutions LLC
        </footer>
      </body>
    </html>
  );
}
