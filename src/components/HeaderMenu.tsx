"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * The header's navigation and theme control. From the `sm` breakpoint up
 * they sit inline in the header; on a phone they fold behind a Menu button,
 * so the header is one row (about 60 px) instead of three. The menu closes
 * when a link is followed.
 */
export default function HeaderMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const [shownFor, setShownFor] = useState(pathname);
  // Close on navigation (render-time reset, not an effect, so no flash).
  if (shownFor !== pathname) {
    setShownFor(pathname);
    setOpen(false);
  }

  // Publish the header's height (it is sticky from sm up) so sticky content
  // below it, such as the lead list's column headers, can sit just under it.
  useEffect(() => {
    const header = document.querySelector("body > header");
    if (!header || typeof ResizeObserver === "undefined") return;
    const publish = () => document.documentElement.style.setProperty("--site-header-h", `${header.getBoundingClientRect().height}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="site-menu"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 sm:hidden dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        <svg aria-hidden viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          {open ? <path d="M5 5l10 10M15 5L5 15" /> : <path d="M3 6h14M3 10h14M3 14h14" />}
        </svg>
        Menu
      </button>
      <div
        id="site-menu"
        className={`${open ? "flex" : "hidden"} w-full flex-col gap-2 pb-2 sm:flex sm:w-auto sm:flex-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3 sm:pb-0 lg:flex-none lg:flex-nowrap`}
      >
        {children}
      </div>
    </>
  );
}
