"use client";

import { useEffect } from "react";

/**
 * Feeds the pointer's position inside a hoverable card to CSS (--mx, --my),
 * which draws a soft light and a brighter edge that follow it (motion.css).
 * One listener for the whole page, at most one style write per frame.
 */
export default function PointerLight() {
  useEffect(() => {
    if (!window.matchMedia?.("(hover: hover) and (prefers-reduced-motion: no-preference)").matches) return;
    let frame = 0;
    let last: PointerEvent | null = null;
    function paint() {
      frame = 0;
      const event = last;
      const card = event?.target instanceof Element ? event.target.closest<HTMLElement>(".card-hover") : null;
      if (!event || !card) return;
      const rect = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${event.clientX - rect.left}px`);
      card.style.setProperty("--my", `${event.clientY - rect.top}px`);
    }
    function onMove(event: PointerEvent) {
      last = event;
      if (!frame) frame = requestAnimationFrame(paint);
    }
    document.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      document.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}
