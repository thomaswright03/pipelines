"use client";

import { useEffect, useState } from "react";

/**
 * A number that counts up to its value when it first appears (the
 * dashboard's tiles, the stats cards). The server renders the real value,
 * and it is what is shown when the viewer prefers reduced motion; links
 * around it carry the value in their accessible name.
 */
export default function CountUp({ value, duration = 1100, delay = 220 }: { value: number; duration?: number; delay?: number }) {
  // What the digits show mid-count; null once they settle on (or never leave) the value.
  const [shown, setShown] = useState<number | null>(null);

  useEffect(() => {
    if (value <= 0 || !window.matchMedia || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const start = performance.now() + delay;
    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / duration));
      // Ease out (quartic): quick at first, settling on the value.
      setShown(t < 1 ? Math.round(value * (1 - (1 - t) ** 4)) : null);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      setShown(null);
    };
  }, [value, duration, delay]);

  return <span className="tabular-nums">{(shown ?? value).toLocaleString("en-US")}</span>;
}
