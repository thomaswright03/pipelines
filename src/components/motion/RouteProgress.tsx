"use client";

import { useEffect, useState } from "react";

/**
 * A thin gold bar along the top of the window while the next page is on
 * its way (motion.css, .route-progress). It starts when an in-app link is
 * followed and completes when the address changes, which the router does
 * as it shows the new page. Quick navigations (a prefetched page) finish
 * before it would show, so it never flickers.
 */
export default function RouteProgress() {
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");

  useEffect(() => {
    let showTimer: ReturnType<typeof setTimeout> | undefined;
    let watcher: ReturnType<typeof setInterval> | undefined;
    let giveUp: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      clearTimeout(showTimer);
      clearInterval(watcher);
      clearTimeout(giveUp);
    };

    function onClick(event: MouseEvent) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      const next = new URL(link.href, location.href);
      if (next.origin !== location.origin) return;
      // Same page (or only a #section on it): nothing loads.
      if (next.pathname === location.pathname && next.search === location.search) return;
      stop();
      const from = location.href;
      const arrived = () => location.href !== from;
      showTimer = setTimeout(() => {
        if (!arrived()) setState("loading");
      }, 120);
      watcher = setInterval(() => {
        if (!arrived()) return;
        stop();
        setState((s) => (s === "loading" ? "done" : "idle"));
      }, 80);
      // Never left running (a navigation that was cancelled, or failed).
      giveUp = setTimeout(() => {
        stop();
        setState("idle");
      }, 15_000);
    }
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("click", onClick);
      stop();
    };
  }, []);

  useEffect(() => {
    if (state !== "done") return;
    const t = setTimeout(() => setState("idle"), 700);
    return () => clearTimeout(t);
  }, [state]);

  return <div aria-hidden className="route-progress" data-state={state} />;
}
