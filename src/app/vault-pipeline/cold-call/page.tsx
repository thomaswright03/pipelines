import type { Metadata } from "next";
import CallDeckPage from "@/components/CallDeckPage";

export const metadata: Metadata = { title: "Cold Outreach — Call deck" };
export const dynamic = "force-dynamic";

export default async function ColdCallPage({ searchParams }: PageProps<"/vault-pipeline/cold-call">) {
  const { after } = await searchParams;
  return <CallDeckPage pipeline="cold-outreach" title="Cold Outreach — call deck" after={after} />;
}
