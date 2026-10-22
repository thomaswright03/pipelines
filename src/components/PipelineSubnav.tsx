"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Leads · Call deck · Sent & replies · Stats, shown on every page of a pipeline.
export default function PipelineSubnav({ basePath, label }: { basePath: string; label: string }) {
  const pathname = usePathname();
  const links = [
    { href: basePath, label: "Leads", active: pathname === basePath || /^\/[^/]+\/(?!cold-call|stats|inbox)[^/]+$/.test(pathname) },
    { href: `${basePath}/cold-call`, label: "Call deck", active: pathname.startsWith(`${basePath}/cold-call`) },
    { href: `${basePath}/inbox`, label: "Sent & replies", active: pathname.startsWith(`${basePath}/inbox`) },
    { href: `${basePath}/stats`, label: "Stats", active: pathname.startsWith(`${basePath}/stats`) },
  ];
  // Moving right along the tabs slides the pages left, and back again (motion.css).
  const current = links.findIndex((l) => l.active);
  return (
    <nav aria-label={`${label} sections`} className="flex flex-wrap gap-1.5">
      {links.map((l, index) => (
        <Link
          key={l.href}
          href={l.href}
          transitionTypes={current < 0 || index === current ? undefined : [index > current ? "nav-forward" : "nav-back"]}
          aria-current={l.active ? "page" : undefined}
          className={l.active ? "tab-active" : "tab-inactive"}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
