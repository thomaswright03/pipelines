"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { updatePipelineMetaAction } from "@/lib/actions/pipeline-meta";
import type { PipelineMetaFields } from "@/lib/pipeline-meta-defaults";

type InternalProps = {
  kind: "internal";
  href: string;
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
      const result = await updatePipelineMetaAction(pipelineId, formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <div className="card card-hover flex flex-col gap-3 p-5">
      {editing ? (
        <form action={save} className="flex flex-col gap-2">
          <EditField label="Pipeline name" name="name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <EditField label="Company" name="company" value={form.company} onChange={(v) => setForm({ ...form, company: v })} />
          <EditField
            label="Product description"
            name="productDescription"
            value={form.productDescription}
            onChange={(v) => setForm({ ...form, productDescription: v })}
            textarea
          />
          <EditField
            label="Pipeline description"
            name="pipelineDescription"
            value={form.pipelineDescription}
            onChange={(v) => setForm({ ...form, pipelineDescription: v })}
            textarea
          />
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
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
                <h2 className="font-semibold">{meta.name}</h2>
                {meta.company && <p className="text-xs text-zinc-500">{meta.company}</p>}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {rest.kind === "hosted" && (
                <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Always-on
                </span>
              )}
              <button onClick={() => setEditing(true)} className="btn-ghost px-2 py-1 text-xs">
                Edit
              </button>
            </div>
          </div>

          {meta.productDescription && (
            <div>
              <div className="text-xs font-medium uppercase text-zinc-400">Product</div>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">{meta.productDescription}</p>
            </div>
          )}
          {meta.pipelineDescription && (
            <div>
              <div className="text-xs font-medium uppercase text-zinc-400">Pipeline</div>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">{meta.pipelineDescription}</p>
            </div>
          )}
        </>
      )}

      {!editing && (
        <div>
          {rest.kind === "internal" ? (
            <Link href={rest.href} className="btn-primary">
              Open pipeline
            </Link>
          ) : (
            <a href={rest.dashboardUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary">
              View on Vercel ↗
            </a>
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
}: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  textarea?: boolean;
}) {
  const className = "input";
  return (
    <label className="flex flex-col gap-1 text-xs text-zinc-500">
      {label}
      {textarea ? (
        <textarea name={name} value={value} onChange={(e) => onChange(e.target.value)} rows={2} className={className} />
      ) : (
        <input name={name} value={value} onChange={(e) => onChange(e.target.value)} className={className} />
      )}
    </label>
  );
}
