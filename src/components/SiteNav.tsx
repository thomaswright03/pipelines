"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/dataleadsell", label: "dataleadsell.com" },
  { href: "/vault-pipeline", label: "Cold Outreach" },
  { href: "/garbage-ai", label: "Garbage AI" },
  { href: "/room-designer", label: "Room Designer 3D" },
  { href: "/replies", label: "Unmatched replies" },
  { href: "/settings", label: "Settings" },
];

/**
 * `unmatchedReplies`: replies waiting to be matched to a lead, shown as a
 * count on "Unmatched replies" — green when some of them (`interestedReplies`) read
 * as interested.
 */
export default function SiteNav({
  unmatchedReplies = 0,
  interestedReplies = 0,
}: {
  unmatchedReplies?: number;
  interestedReplies?: number;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="flex flex-wrap gap-1 text-sm lg:flex-nowrap">
      {LINKS.map(({ href, label }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`inline-flex min-h-11 items-center whitespace-nowrap rounded-md px-2.5 py-1.5 font-medium transition sm:min-h-8 lg:px-1.5 xl:px-2.5 ${
              active
                ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300"
                : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            }`}
          >
            {label}
            {href === "/replies" && unmatchedReplies > 0 && (
              <span
                title={
                  interestedReplies > 0
                    ? `${unmatchedReplies} waiting to be matched, ${interestedReplies} interested`
                    : "Waiting to be matched"
                }
                className={`ml-1.5 rounded-full px-1.5 text-xs font-semibold ${
                  interestedReplies > 0
                    ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-200"
                    : "bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200"
                }`}
              >
                {unmatchedReplies}
                <span className="sr-only"> waiting to be matched{interestedReplies > 0 ? `, ${interestedReplies} interested` : ""}</span>
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
