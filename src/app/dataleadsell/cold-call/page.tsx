import type { Metadata } from "next";
import CallDeckPage from "@/components/CallDeckPage";

export const metadata: Metadata = { title: "dataleadsell — Call deck" };
export const dynamic = "force-dynamic";

// Agents who didn't answer the email (or had none) — the phone follow-up.
export default async function AgentColdCallPage({ searchParams }: PageProps<"/dataleadsell/cold-call">) {
  const { after } = await searchParams;
  return <CallDeckPage pipeline="dataleadsell" title="dataleadsell.com — call deck" after={after} />;
}
