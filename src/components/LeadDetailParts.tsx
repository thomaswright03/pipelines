// Pieces shared by both pipelines' lead pages (server components).
import type { LedgerNote } from "@/lib/lead-page";
import { formatDateTime } from "@/lib/time";

export function DetailField({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs muted">{label}</dt>
      <dd className="break-words">
        {href && value !== "—" ? (
          <a href={href} className="text-indigo-700 underline-offset-2 hover:underline dark:text-indigo-300" rel="noopener noreferrer" target={href.startsWith("http") ? "_blank" : undefined}>
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

export function LedgerNotice({ note }: { note: LedgerNote }) {
  if (!note) return null;
  return <p className={note.tone === "warning" ? "notice-warning" : "notice-info"}>{note.text}</p>;
}

export function EmailPreview({ subject, body }: { subject: string; body: string }) {
  return (
    <section aria-labelledby="preview-heading" className="card p-4">
      <h2 id="preview-heading" className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
        Outreach email preview
      </h2>
      <p className="text-sm font-medium">{subject}</p>
      <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-sm muted">{body}</pre>
    </section>
  );
}

export function SendHistory({ logs }: { logs: { id: string; sentAt: Date; bounced: boolean }[] }) {
  if (logs.length === 0) return null;
  return (
    <section aria-labelledby="history-heading" className="card p-4">
      <h2 id="history-heading" className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
        Send history
      </h2>
      <ul className="flex flex-col gap-1.5 text-sm">
        {logs.map((log) => (
          <li key={log.id} className="flex items-center justify-between gap-2">
            <span>{formatDateTime(log.sentAt)}</span>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
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
