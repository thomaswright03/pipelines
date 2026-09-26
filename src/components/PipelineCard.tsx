"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { updatePipelineMetaAction } from "@/lib/actions/pipeline-meta";
import type { PipelineMetaFields } from "@/lib/pipeline-meta-defaults";
import type { DashboardNumbers } from "@/lib/dashboard";

type InternalProps = {
  kind: "internal";
  href: string;
  numbers: DashboardNumbers;
};

type HostedProps = {
  kind: "hosted";
  dashboardUrl: string;
};

export default function PipelineCard({
  pipelineId,
  meta,
  ...rest
}: { pipelineId: string; meta: PipelineMetaFields } & (InternalProps | HostedProps)) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(meta);

  function save(formData: FormData) {
    setError(null);
    startTransition(async () => {
      let result: { error?: string };
      try {
        result = await updatePipelineMetaAction(pipelineId, formData);
      } catch {
        result = { error: "Couldn't reach the server — nothing was saved. Try again." };
      }
      if (result.error) {
        setError(result.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <div className={rest.kind === "internal" ? "card card-hover flex flex-col gap-3 p-5" : "card flex flex-col gap-3 p-4 text-sm"}>
      {editing ? (
        <form action={save} className="flex flex-col gap-2">
          <EditField label="Pipeline name" name="name" maxLength={80} value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <EditField
            label="Company"
            name="company"
            maxLength={160}
            value={form.company}
            onChange={(v) => setForm({ ...form, company: v })}
          />
          <EditField
            label="Product description"
            name="productDescription"
            maxLength={600}
            value={form.productDescription}
            onChange={(v) => setForm({ ...form, productDescription: v })}
            textarea
          />
          <EditField
            label="Pipeline description"
            name="pipelineDescription"
            maxLength={600}
            value={form.pipelineDescription}
            onChange={(v) => setForm({ ...form, pipelineDescription: v })}
            textarea
          />
          <div aria-live="polite">{error && <p className="notice-error">{error}</p>}</div>
          <div className="flex gap-2">
            <button type="submit" disabled={isPending} className="btn-primary">
              {isPending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setForm(meta);
                setError(null);
                setEditing(false);
              }}
              className="btn-secondary"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-bold text-white shadow-sm shadow-indigo-600/25">
                {meta.name.slice(0, 1).toUpperCase()}
              </span>
              <div>
                <h2 className="break-words font-semibold">{meta.name}</h2>
                {meta.company && <p className="text-xs muted">{meta.company}</p>}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {rest.kind === "hosted" && (
                // Not a health indicator: this app doesn't check the hosted service.
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  Runs separately
                </span>
              )}
              <button onClick={() => setEditing(true)} className="btn-ghost text-xs">
                Edit
              </button>
            </div>
          </div>

          {meta.productDescription && (
            <div>
              <div className="text-xs font-medium uppercase text-zinc-600 dark:text-zinc-400">Product</div>
              <p className="break-words text-sm muted">{meta.productDescription}</p>
            </div>
          )}
          {meta.pipelineDescription && (
            <div>
              <div className="text-xs font-medium uppercase text-zinc-600 dark:text-zinc-400">Pipeline</div>
              <p className="break-words text-sm muted">{meta.pipelineDescription}</p>
            </div>
          )}
          {rest.kind === "internal" && <KeyNumbers href={rest.href} numbers={rest.numbers} />}
        </>
      )}

      {!editing && (
        <div>
          {rest.kind === "internal" ? (
            <Link href={rest.href} className="btn-primary">
              Open pipeline
            </Link>
          ) : (
            <div className="flex flex-col items-start gap-1">
              <p className="text-sm muted">Answers new GoHighLevel leads on its own — there is nothing to operate here.</p>
              <a href={rest.dashboardUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost -ml-2 text-xs">
                Check that it&apos;s running ↗
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EditField({
  label,
  name,
  value,
  onChange,
  textarea,
  maxLength,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  textarea?: boolean;
  maxLength: number;
}) {
  return (
    <label className="field-label">
      {label}
      {textarea ? (
        <textarea name={name} value={value} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} rows={3} className="input" />
      ) : (
        <input name={name} value={value} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} className="input" />
      )}
    </label>
  );
}

/** What is waiting on the operator in this pipeline, each linking to where it's handled. */
function KeyNumbers({ href, numbers }: { href: string; numbers: DashboardNumbers }) {
  const items = [
    { label: "Ready to email", value: numbers.readyToEmail, to: `${href}?status=new` },
    { label: "Waiting on a reply", value: numbers.waitingOnReply, to: `${href}?status=contacted` },
    { label: "Replied", value: numbers.replied, to: `${href}?status=responded` },
    { label: "To call", value: numbers.onCallDeck, to: `${href}/cold-call` },
  ];
  return (
    <div className="flex flex-col gap-2">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {items.map((item) => (
          <div key={item.label} className="rounded-lg bg-zinc-50 px-2.5 py-2 dark:bg-zinc-800/60">
            <dt className="text-xs muted">{item.label}</dt>
            <dd>
              <Link
                href={item.to}
                aria-label={`${item.label}: ${item.value.toLocaleString("en-US")}`}
                className="text-lg font-semibold tabular-nums hover:underline"
              >
                {item.value.toLocaleString("en-US")}
              </Link>
            </dd>
          </div>
        ))}
      </dl>
      {numbers.needsALook > 0 && (
        <p className="notice-warning">
          {numbers.needsALook === 1 ? "1 reply needs" : `${numbers.needsALook.toLocaleString("en-US")} replies need`} a look — open the
          pipeline to see {numbers.needsALook === 1 ? "it" : "them"}.
        </p>
      )}
    </div>
  );
}
