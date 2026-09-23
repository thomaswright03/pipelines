import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import AgentLeadActions from "@/components/AgentLeadActions";
import { buildAgentOutreachEmail } from "@/lib/dataleadsell-email-template";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // "Find email" now guesses a website first, which can take a few tries.

export default async function AgentLeadDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lead = await prisma.agentLead.findUnique({ where: { id }, include: { emailLogs: { orderBy: { sentAt: "desc" } } } });
  if (!lead) notFound();

  const preview = buildAgentOutreachEmail(lead.name, lead.county);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/dataleadsell" className="text-sm font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400">
          ← All agents
        </Link>
        <h1 className="accent-text mt-1 text-2xl font-bold tracking-tight">{lead.name}</h1>
        {lead.brokerage && <p className="text-zinc-500">{lead.brokerage}</p>}
      </div>

      <div className="grid gap-6 sm:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-4">
          <div className="card p-4">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Field label="Email" value={lead.email ?? "—"} />
              <Field label="Phone" value={lead.phone ?? "—"} />
              <Field label="City" value={lead.city ?? "—"} />
              <Field label="County" value={lead.county ? `${lead.county}, ${lead.state}` : "—"} />
              <Field label="Website" value={lead.website ?? "—"} />
              <Field label="Source" value={lead.source ?? "—"} />
              <Field label="Last emailed" value={lead.lastEmailedAt ? lead.lastEmailedAt.toLocaleString() : "—"} />
              <Field label="Replied" value={lead.repliedAt ? lead.repliedAt.toLocaleString() : "—"} />
            </dl>
          </div>

          <div className="card p-4">
            <h2 className="mb-2 text-sm font-semibold text-zinc-500">Outreach email preview</h2>
            <p className="text-sm font-medium">{preview.subject}</p>
            <pre className="mt-2 whitespace-pre-wrap text-sm text-zinc-600 dark:text-zinc-400">{preview.body}</pre>
          </div>

          {lead.emailLogs.length > 0 && (
            <div className="card p-4">
              <h2 className="mb-2 text-sm font-semibold text-zinc-500">Send history</h2>
              <ul className="flex flex-col gap-1.5 text-sm">
                {lead.emailLogs.map((log) => (
                  <li key={log.id} className="flex items-center justify-between">
                    <span>{log.sentAt.toLocaleString()}</span>
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                        log.bounced
                          ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
                          : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${log.bounced ? "bg-red-500" : "bg-emerald-500"}`} />
                      {log.bounced ? "Bounced" : "Sent"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <AgentLeadActions leadId={lead.id} status={lead.status} hasEmail={Boolean(lead.email)} />
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
