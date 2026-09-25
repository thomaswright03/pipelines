import Link from "next/link";
import { prisma } from "@/lib/db";
import SettingsControls from "@/components/SettingsControls";
import { getAppSettings } from "@/lib/outreach/settings";
import { resolveTransportKind } from "@/lib/mail-transport-kind";
import { formatDate, formatDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";

const TRANSPORT_DESCRIPTION = {
  zeptomail: "ZeptoMail (real delivery to recipients).",
  smtp: "The SMTP server in SMTP_HOST — meant for a local mail catcher such as Mailpit.",
  outbox: "Written to .eml files in the local outbox folder. Nothing is delivered.",
} as const;

export default async function SettingsPage() {
  const [settings, suppressed, suppressedCount] = await Promise.all([
    getAppSettings(),
    prisma.suppressedEmail.findMany({ orderBy: { createdAt: "desc" }, take: 25 }),
    prisma.suppressedEmail.count(),
  ]);
  const transport = resolveTransportKind();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="accent-text text-2xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm muted">Switches that apply to both pipelines.</p>
      </div>

      <SettingsControls
        paused={settings.outboundPaused}
        pausedSince={settings.pausedAt ? formatDateTime(settings.pausedAt) : null}
        allowCrossPipelineRepeats={settings.allowCrossPipelineRepeats}
      />

      <section aria-labelledby="transport-heading" className="card flex flex-col gap-2 p-4">
        <h2 id="transport-heading" className="text-base font-semibold">
          Where email goes
        </h2>
        <p className="text-sm">{TRANSPORT_DESCRIPTION[transport]}</p>
        <p className="text-xs muted">Set by EMAIL_TRANSPORT (see the README); deployments on Vercel use ZeptoMail by default.</p>
      </section>

      <section aria-labelledby="dne-heading" className="card flex flex-col gap-2 p-4">
        <h2 id="dne-heading" className="text-base font-semibold">
          Do-not-email list ({suppressedCount.toLocaleString("en-US")})
        </h2>
        <p className="text-sm muted">
          Addresses that opted out. Neither pipeline emails them. To undo a wrong entry, open a lead with that address and use
          “Remove from do-not-email list”.
        </p>
        {suppressed.length === 0 ? (
          <p className="text-sm muted">Nobody has opted out.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
                <tr>
                  <th className="py-2 pr-3">Address</th>
                  <th className="py-2 pr-3">Since</th>
                  <th className="py-2">Why</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {suppressed.map((s) => (
                  <tr key={s.email}>
                    <td className="max-w-[16rem] truncate py-2 pr-3" title={s.email}>
                      {s.email}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 muted">{formatDate(s.createdAt)}</td>
                    <td className="py-2 muted">
                      {s.source === "inbound_reply"
                        ? `Reply said “${s.evidence ?? "opt out"}”`
                        : s.source === "manual"
                          ? "Marked by hand"
                          : (s.reason ?? "—")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {suppressedCount > suppressed.length && <p className="mt-2 text-xs muted">Showing the latest {suppressed.length}.</p>}
          </div>
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
