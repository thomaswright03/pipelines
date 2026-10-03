"use client";

// Settings → Connections "Check the reply loop": sends the real pitch to
// an address the operator controls, then shows whether their reply came
// back and was recorded (src/lib/outreach/reply-check.ts).
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startReplyCheckAction } from "@/lib/actions/settings";
import ActionMessage, { type Feedback } from "@/components/ActionMessage";
import { useConfirm } from "@/components/ConfirmDialog";

export type ReplyCheckRow = {
  leadId: string;
  email: string;
  state: "not_sent" | "waiting" | "late" | "recorded";
  sentAt: string | null;
  status: string;
  reply: { receivedAt: string; readAs: string } | null;
};

const TONE: Record<ReplyCheckRow["state"], string> = {
  recorded: "notice-success",
  waiting: "notice-info",
  late: "notice-warning",
  not_sent: "notice-error",
};

function describe(row: ReplyCheckRow): string {
  switch (row.state) {
    case "recorded":
      return `Passed. Pitch sent ${row.sentAt}; your reply was recorded ${row.reply!.receivedAt}, read as ${row.reply!.readAs}. The lead is now ${row.status}.`;
    case "waiting":
      return `Pitch sent ${row.sentAt}. Waiting for your reply — answer the email from ${row.email}, then reload this page.`;
    case "late":
      return `Pitch sent ${row.sentAt}, but no reply has been recorded. If you replied more than a few minutes ago, replies aren't reaching the app: see “Receiving replies” above.`;
    case "not_sent":
      return "The pitch wasn't sent — open the lead to see why.";
  }
}

export default function ReplyCheck({ checks }: { checks: ReplyCheckRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [dialog, confirm] = useConfirm();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    if (!email.trim()) {
      setFeedback({ ok: false, text: "Enter an address you can read, like you@example.com." });
      return;
    }
    const confirmed = await confirm({
      title: `Send the Cold Outreach pitch to ${email.trim()}?`,
      body: (
        <p>
          This creates a Cold Outreach lead called “Reply check” with that address and sends it the real pitch. Reply from that inbox, and
          the result shows here. Each address gets one pitch, so use a new one (a plus-address works) for the next check.
        </p>
      ),
      confirmLabel: "Send test pitch",
    });
    if (!confirmed) return;
    startTransition(async () => {
      try {
        const result = await startReplyCheckAction(email);
        if (result.ok) setEmail("");
        setFeedback(result.ok ? { ok: true, text: result.message } : { ok: false, text: result.error });
      } catch {
        setFeedback({ ok: false, text: "Couldn't reach the server — check Cold Outreach for a “Reply check” lead before trying again." });
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
      {dialog}
      <div>
        <h3 className="text-sm font-semibold">Check the reply loop</h3>
        <p className="mt-1 text-sm muted">
          After a deploy, send yourself the real pitch and reply to it: this proves sending, reply forwarding and reply recording end to
          end.
        </p>
      </div>
      <form onSubmit={submit} noValidate className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="field-label min-w-0 sm:flex-1">
          An address you can read
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={254}
            placeholder="you+check1@example.com"
            className="input"
          />
        </label>
        <button type="submit" disabled={isPending} className="btn-secondary">
          {isPending ? "Sending…" : "Send test pitch"}
        </button>
      </form>
      <ActionMessage feedback={feedback} />
      {checks.length > 0 && (
        <ul aria-label="Recent reply-loop checks" className="flex flex-col gap-2">
          {checks.map((row) => (
            <li key={row.leadId} className={`${TONE[row.state]} flex flex-col gap-1`}>
              <span className="break-all font-medium">{row.email}</span>
              <span>{describe(row)}</span>
              <Link href={`/vault-pipeline/${row.leadId}`} className="self-start font-medium underline underline-offset-2">
                Open the Reply check lead
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
