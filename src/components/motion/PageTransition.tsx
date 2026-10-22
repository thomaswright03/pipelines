"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

// React's <ViewTransition> ships in the React build the App Router uses; elsewhere
// (the unit tests' plain React) the page renders without it.
const ViewTransition: React.ComponentType<React.ViewTransitionProps> | undefined = (
  React as { ViewTransition?: React.ComponentType<React.ViewTransitionProps> }
).ViewTransition;

/**
 * Animates one page handing over to the next (motion.css): keyed by the
 * path, so a new path is an exit of the old page and an enter of the new
 * one. Links carrying a "nav-forward" or "nav-back" transition type slide
 * the pages past each other; every other route change rises out of a blur.
 * Refreshes and query-string changes (filters, sorting) stay put.
 */
export default function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (!ViewTransition) return children;
  const motion = { "nav-forward": "nav-forward", "nav-back": "nav-back", default: "page" };
  return (
    <ViewTransition key={pathname} enter={motion} exit={motion} update="none" default="none">
      {children}
    </ViewTransition>
  );
}
