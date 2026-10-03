import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import SettingsControls from "@/components/SettingsControls";
import { AddSuppressionForm, DoNotEmailRows } from "@/components/DoNotEmailList";
import { getAppSettings } from "@/lib/outreach/settings";
import { formatDate, formatDateTime } from "@/lib/time";
import { getConnectionStatus } from "@/lib/integration-status";
import ConnectionStatusList from "@/components/ConnectionStatusList";
import ReplyCheck, { type ReplyCheckRow } from "@/components/ReplyCheck";
import { listReplyChecks, type ReplyCheckView } from "@/lib/outreach/reply-check";
import { statusLabel } from "@/lib/lead-status";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

const DNE_PAGE_SIZE = 25;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function whyText(s: { source: string | null; evidence: string | null; reason: string | null }): string {
  if (s.source === "inbound_reply") return `Reply said “${s.evidence ?? "opt out"}”`;
  if (s.source === "manual") return s.evidence ? `Marked by hand: ${s.evidence}` : "Marked by hand";
  return s.reason ?? "—";
}

const READ_AS: Record<string, string> = {
  opt_out: "an opt-out (the address is now on the do-not-email list)",
  positive: "interested",
  declined: "a plain no",
  acknowledged: "a thank-you only",
  needs_look: "needing a look",
};

function toReplyCheckRow(check: ReplyCheckView): ReplyCheckRow {
  const reply = check.reply;
  return {
    leadId: check.leadId,
    email: check.email,
    state: check.state,
    sentAt: check.sentAt ? formatDateTime(check.sentAt) : null,
    status: statusLabel(check.status),
    reply: reply
      ? {
          receivedAt: formatDateTime(reply.receivedAt),
          readAs:
            reply.kind === "reply"
              ? (READ_AS[reply.verdict ?? ""] ?? "a reply")
              : reply.kind === "bounce"
                ? "a bounce (the address couldn't be delivered to)"
                : "an automatic reply",
        }
      : null,
  };
}

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const raw = await searchParams;
  const q = first(raw.q).trim().slice(0, 100);
  const requestedPage = Math.max(1, Number.parseInt(first(raw.page), 10) || 1);
  const where = q ? { email: { contains: q.toLowerCase() } } : {};

  const [settings, matching, suppressedCount, connections, replyChecks] = await Promise.all([
    getAppSettings(),
    prisma.suppressedEmail.count({ where }),
    prisma.suppressedEmail.count(),
    getConnectionStatus(),
    listReplyChecks(),
  ]);
  const pages = Math.max(1, Math.ceil(matching / DNE_PAGE_SIZE));
  const page = Math.min(requestedPage, pages);
  const suppressed = await prisma.suppressedEmail.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * DNE_PAGE_SIZE,
    take: DNE_PAGE_SIZE,
  });
  const pageHref = (n: number) => `/settings?${new URLSearchParams({ ...(q ? { q } : {}), page: String(n) })}#dne-heading`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="accent-text text-2xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm muted">
          Switches that apply to every pipeline. New to running the pipelines? Read the{" "}
          <Link href="/help" className="text-indigo-700 underline underline-offset-2 dark:text-indigo-300">
            operator guide
          </Link>
          .
        </p>
      </div>

      <SettingsControls
        paused={settings.switchPaused}
        offByEnvironment={settings.pausedBy === "environment"}
        pausedSince={settings.pausedAt ? formatDateTime(settings.pausedAt) : null}
        allowCrossPipelineRepeats={settings.allowCrossPipelineRepeats}
      />

      <section aria-labelledby="connections-heading" className="card flex flex-col gap-3 p-4">
        <div>
          <h2 id="connections-heading" className="text-base font-semibold">
            Connections
          </h2>
          <p className="mt-1 text-sm muted">
            Whether each outside service the pipelines depend on is working. &ldquo;Working&rdquo; means it has actually worked — a send, a
            search, a reply or a test — not just that it&apos;s set up.
          </p>
        </div>
        <ConnectionStatusList items={connections} />
        <ReplyCheck checks={replyChecks.map(toReplyCheckRow)} />
      </section>

      <section aria-labelledby="dne-heading" className="card flex flex-col gap-3 p-4">
        <h2 id="dne-heading" className="text-base font-semibold">
          Do-not-email list ({suppressedCount.toLocaleString("en-US")})
        </h2>
        <p className="text-sm muted">
          Addresses that opted out. No pipeline emails them. Replies asking to stop are added automatically; add anyone who asked another
          way below.
        </p>
        <AddSuppressionForm />
        <form method="get" action="/settings" className="flex flex-wrap items-end gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <label className="field-label min-w-0 flex-1">
            Search the list
            <input name="q" defaultValue={q} maxLength={100} placeholder="Part of an address" className="input" />
          </label>
          <button type="submit" className="btn-secondary">
            Search
          </button>
          {q && (
            <Link href="/settings#dne-heading" className="btn-ghost">
              Clear
            </Link>
          )}
        </form>
        {suppressed.length === 0 ? (
          <p className="text-sm muted">{q ? `No address on the list contains “${q}”.` : "Nobody has opted out."}</p>
        ) : (
          <DoNotEmailRows rows={suppressed.map((s) => ({ email: s.email, since: formatDate(s.createdAt), why: whyText(s) }))} />
        )}
        {pages > 1 && (
          <nav aria-label="Do-not-email list pages" className="flex flex-wrap items-center gap-3 text-sm">
            {page > 1 && (
              <Link href={pageHref(page - 1)} className="btn-ghost">
                ← Newer
              </Link>
            )}
            <span className="muted">
              Page {page} of {pages} · {matching.toLocaleString("en-US")} {q ? "matching" : "addresses"}
            </span>
            {page < pages && (
              <Link href={pageHref(page + 1)} className="btn-ghost">
                Older →
              </Link>
            )}
          </nav>
        )}
      </section>

      <p className="text-sm">
        <Link href="/" className="text-indigo-700 hover:underline dark:text-indigo-300">
          ← Dashboard
        </Link>
      </p>
    </div>
  );
}
