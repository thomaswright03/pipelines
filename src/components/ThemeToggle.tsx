"use client";

import { useSyncExternalStore } from "react";
import { THEME_STORAGE_KEY as STORAGE_KEY } from "@/lib/theme";

// Light / Dark / System, remembered per browser. The inline script in
// layout.tsx (src/lib/theme.ts) applies the stored choice before first
// paint; this control changes it afterwards.
type Theme = "light" | "dark" | "system";

function readStored(): Theme {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export default function ThemeToggle() {
  // "system" on the server and during hydration, then the stored choice.
  const theme = useSyncExternalStore(subscribe, readStored, () => "system" as Theme);

  function choose(next: Theme) {
    apply(next);
    try {
      if (next === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private mode etc.: the choice still applies for this page view.
    }
    listeners.forEach((l) => l());
  }

  return (
    <label className="flex shrink-0 items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
      {/* Named on the phone menu, where it stands alone; beside the nav the select speaks for itself. */}
      <span className="sm:sr-only">Theme</span>
      <select
        value={theme}
        onChange={(e) => choose(e.target.value as Theme)}
        className="min-h-11 rounded-md border border-zinc-300 bg-white px-2 text-xs text-zinc-800 sm:min-h-8 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
        aria-label="Color theme"
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}
