"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addSuppressionAction, removeSuppressionByEmailAction } from "@/lib/actions/settings";
import type { ActionResult } from "@/lib/outreach/lead-actions";
import ActionMessage, { type Feedback } from "@/components/ActionMessage";
import { useConfirm } from "@/components/ConfirmDialog";

type SuppressionRow = { email: string; since: string; why: string };

/** The do-not-email list's rows with Remove, plus the "add an address" form. */
export function DoNotEmailRows({ rows }: { rows: SuppressionRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [dialog, confirm] = useConfirm();

  function run(fn: () => Promise<ActionResult>) {
    setFeedback(null);
    startTransition(async () => {
      try {
        const result = await fn();
        setFeedback(result.ok ? { ok: true, text: result.message } : { ok: false, text: result.error });
      } catch {
        setFeedback({ ok: false, text: "Couldn't reach the server — the list didn't change. Try again." });
      }
      router.refresh();
    });
  }

  async function remove(row: SuppressionRow) {
    const confirmed = await confirm({
      title: `Remove ${row.email} from the do-not-email list?`,
      body: (
        <>
          <p>
            On the list since {row.since}. Why: <q className="font-medium">{row.why}</q>
          </p>
          <p className="mt-2">
            Only do this if they did <strong>not</strong> ask to stop — for example, an entry added by mistake. Every pipeline may email
            this address again.
          </p>
        </>
      ),
      confirmLabel: "Remove from list",
      danger: true,
    });
    if (confirmed) run(() => removeSuppressionByEmailAction(row.email));
  }

  return (
    <div className="flex flex-col gap-2">
      {dialog}
      <ActionMessage feedback={feedback} />
      {/* A list, not a table, so a phone shows each address whole on its own
          line with its date and reason under it; from 640px it lines up in
          columns under a header. */}
      <div
        aria-hidden
        className="hidden text-left text-xs uppercase tracking-wide text-zinc-600 sm:grid sm:grid-cols-[minmax(0,18rem)_7rem_minmax(0,1fr)_auto] sm:gap-x-3 dark:text-zinc-400"
      >
        <span>Address</span>
        <span>Since</span>
        <span>Why</span>
        <span className="w-20" />
      </div>
      <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
        {rows.map((row) => (
          <li
            key={row.email}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-0.5 py-2 sm:grid-cols-[minmax(0,18rem)_7rem_minmax(0,1fr)_auto] sm:items-center"
          >
            <span className="col-span-2 font-medium [overflow-wrap:anywhere] sm:col-span-1">
              <BreakableEmail email={row.email} />
            </span>
            <span className="self-center muted">
              <span className="sm:sr-only">Since </span>
              {row.since}
            </span>
            <span className="col-span-2 muted [overflow-wrap:anywhere] sm:col-span-1">
              <span className="sm:sr-only">Why: </span>
              {row.why}
            </span>
            <button
              type="button"
              disabled={isPending}
              onClick={() => remove(row)}
              aria-label={`Remove ${row.email} from the list`}
              className="btn-ghost col-start-2 row-start-2 w-20 text-sm sm:col-start-auto sm:row-start-auto"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** An address that wraps after "@" or a hyphen, or before a dot, rather than mid-word on a narrow screen. */
function BreakableEmail({ email }: { email: string }) {
  const parts = email.split(/(?=\.)|(?<=[@-])/);
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 && <wbr />}
          {part}
        </span>
      ))}
    </>
  );
}

export function AddSuppressionForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    if (!email.trim()) {
      setFeedback({ ok: false, text: "Enter the address to stop emailing." });
      return;
    }
    startTransition(async () => {
      try {
        const result = await addSuppressionAction(email, note);
        if (result.ok) {
          setEmail("");
          setNote("");
        }
        setFeedback(result.ok ? { ok: true, text: result.message } : { ok: false, text: result.error });
      } catch {
        setFeedback({ ok: false, text: "Couldn't reach the server — the list didn't change. Try again." });
      }
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
        <label className="field-label min-w-0 sm:flex-1">
          Address
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={254}
            placeholder="name@business.com"
            className="input"
          />
        </label>
        <label className="field-label min-w-0 sm:flex-1">
          Why (optional)
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Asked by phone" className="input" />
        </label>
        <button type="submit" disabled={isPending} className="btn-secondary">
          {isPending ? "Adding…" : "Add to list"}
        </button>
      </div>
      <ActionMessage feedback={feedback} />
    </form>
  );
}
