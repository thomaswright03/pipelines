import type { Metadata } from "next";
import Link from "next/link";
import { AgentLeadForm, EMPTY_AGENT_LEAD } from "@/components/LeadForms";

export const metadata: Metadata = { title: "Add agent — dataleadsell" };

export default function NewAgentLead() {
  return (
    <div className="mx-auto w-full max-w-lg">
      <Link href="/dataleadsell" className="text-sm font-medium text-indigo-700 hover:text-indigo-600 dark:text-indigo-300">
        ← All agents
      </Link>
      <h1 className="accent-text mt-1 text-2xl font-bold tracking-tight">Add agent</h1>
      <AgentLeadForm mode={{ kind: "create" }} initial={EMPTY_AGENT_LEAD} />
    </div>
  );
}
