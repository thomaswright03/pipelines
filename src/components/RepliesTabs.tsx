import Link from "next/link";

const TABS = [
  { href: "/replies", label: "Unmatched replies" },
  { href: "/inbox", label: "Inbox" },
] as const;

/** Switches between Unmatched replies and the Inbox (everything sent to the outreach address). */
export default function RepliesTabs({ current }: { current: (typeof TABS)[number]["href"] }) {
  return (
    <nav aria-label="Replies sections" className="flex flex-wrap gap-1.5">
      {TABS.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          aria-current={href === current ? "page" : undefined}
          className={href === current ? "tab-active" : "tab-inactive"}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
