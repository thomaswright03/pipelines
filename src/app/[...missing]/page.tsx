import type { Metadata } from "next";
import { notFound } from "next/navigation";

// Any URL no route matches lands here, so the tab says what happened
// ("Page not found · Pipelines") — the root not-found page can't set its
// own title — and then shows the shared not-found page.
export const metadata: Metadata = { title: "Page not found" };

export default function Missing(): never {
  notFound();
}
