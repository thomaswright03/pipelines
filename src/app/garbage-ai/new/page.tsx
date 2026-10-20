import type { Metadata } from "next";
import Link from "next/link";
import { ColdOutreachLeadForm, EMPTY_COLD_OUTREACH_LEAD } from "@/components/LeadForms";

export const metadata: Metadata = { title: "Add hauler — Garbage AI" };

export default function NewHauler() {
  return (
    <div className="mx-auto w-full max-w-lg">
      <Link href="/garbage-ai" className="text-sm font-medium text-indigo-700 hover:text-indigo-600 dark:text-indigo-300">
        ← All haulers
      </Link>
      <h1 className="accent-text mt-1 text-2xl font-bold tracking-tight">Add hauler</h1>
      <ColdOutreachLeadForm mode={{ kind: "create" }} initial={EMPTY_COLD_OUTREACH_LEAD} pipeline="garbage-ai" />
    </div>
  );
}
