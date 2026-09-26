// Pieces shared by both pipelines' lead pages (server components), and the
// page layout itself, so a layout change is made once for both.
import type { ReactNode } from "react";
import Link from "next/link";
import LeadActivityLog from "@/components/LeadActivityLog";
import type { LedgerNote } from "@/lib/lead-page";
import type { PipelineId } from "@/lib/outreach/pipeline-id";
import { formatDateTime } from "@/lib/time";

type SendLogRow = { id: string; sentAt: Date; bounced: boolean; subject: string | null; templateVersion: string | null };

/**
 * A lead page: the name, then the lead's status and actions, then its
 * details, the pitch preview, send history and History. On a phone the
 * actions come first (straight under the name), so Send and Move to… are
 * on the first screen; from the md breakpoint up they sit in a right-hand
 * column beside the details.
 */
export function LeadPageLayout(props: {
  pipeline: PipelineId;
  back: { href: string; label: string };
  lead: { id: string; name: string; notes: string | null };
  subtitle: string | null;
  detailsLabel: string;
  /** DetailField rows. */
  details: ReactNode;
  ledgerNote: LedgerNote;
  preview: { subject: string; body: string; templateVersion: string };
  sendLogs: SendLogRow[];
  activities: { id: string; type: string; notes: string; date: Date }[];
  /** The status and action panels. */
  actions: ReactNode;
}) {
  const { pipeline, lead } = props;
  return (
    <div className="flex flex-col gap-6">
      <div className="min-w-0">
        <Link href={props.back.href} className="text-sm font-medium text-indigo-700 hover:text-indigo-600 dark:text-indigo-300">
          ← {props.back.label}
        </Link>
        <h1 className="accent-text-solid mt-1 break-words text-2xl font-bold tracking-tight">{lead.name}</h1>
        {props.subtitle && <p className="muted">{props.subtitle}</p>}
      </div>

      <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
        <div className="flex min-w-0 flex-col gap-4 md:col-start-2 md:row-start-1" data-testid="lead-actions-column">
          {props.actions}
        </div>

        <div className="flex min-w-0 flex-col gap-4 md:col-start-1 md:row-start-1">
          <LedgerNotice note={props.ledgerNote} />
          <section className="card p-4" aria-label={props.detailsLabel}>
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">{props.details}</dl>
            {lead.notes && (
              <div className="mt-3 border-t border-zinc-200 pt-3 text-sm dark:border-zinc-800">
                <div className="text-sm muted">Notes</div>
                <p className="mt-1 whitespace-pre-wrap break-words">{lead.notes}</p>
              </div>
            )}
          </section>

          <EmailPreview {...props.preview} />
          <SendHistory logs={props.sendLogs} currentVersion={props.preview.templateVersion} />
          <LeadActivityLog
            pipeline={pipeline}
            leadId={lead.id}
            activities={props.activities.map((a) => ({ id: a.id, type: a.type, notes: a.notes, date: formatDateTime(a.date) }))}
          />
        </div>
      </div>
    </div>
  );
}

export function DetailField({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs muted">{label}</dt>
      <dd className="break-words">
        {href && value !== "—" ? (
          <a
            href={href}
            className="text-indigo-700 underline-offset-2 hover:underline dark:text-indigo-300"
            rel="noopener noreferrer"
            target={href.startsWith("http") ? "_blank" : undefined}
          >
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

function LedgerNotice({ note }: { note: LedgerNote }) {
  if (!note) return null;
  return <p className={note.tone === "warning" ? "notice-warning" : "notice-info"}>{note.text}</p>;
}

function EmailPreview({ subject, body, templateVersion }: { subject: string; body: string; templateVersion: string }) {
  return (
    <section aria-labelledby="preview-heading" className="card p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id="preview-heading" className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          Outreach email preview
        </h2>
        <span className="text-xs muted">Template {templateVersion}</span>
      </div>
      <p className="text-sm font-medium">{subject}</p>
      <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-sm muted">{body}</pre>
    </section>
  );
}

function SendHistory({ logs, currentVersion }: { logs: SendLogRow[]; currentVersion: string }) {
  if (logs.length === 0) return null;
  return (
    <section aria-labelledby="history-heading" className="card p-4">
      <h2 id="history-heading" className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
        Send history
      </h2>
      <ul className="flex flex-col gap-1.5 text-sm">
        {logs.map((log) => (
          <li key={log.id} className="flex items-center justify-between gap-2">
            <span className="min-w-0">
              {formatDateTime(log.sentAt)}
              {log.subject && <span className="block break-words text-xs muted">“{log.subject}”</span>}
              {log.templateVersion && (
                <span className="block text-xs muted">
                  Template {log.templateVersion}
                  {log.templateVersion !== currentVersion && " (an earlier wording)"}
                </span>
              )}
            </span>
            <span
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                log.bounced
                  ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
                  : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${log.bounced ? "bg-red-500" : "bg-emerald-500"}`} aria-hidden />
              {log.bounced ? "Bounced" : "Sent"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
