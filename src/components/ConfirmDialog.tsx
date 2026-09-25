"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export type ConfirmOptions = {
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
};

type Pending = ConfirmOptions & { resolve: (confirmed: boolean) => void };

/**
 * A confirmation step for consequential actions, as a real modal <dialog>
 * (focus is trapped, Esc cancels). Usage:
 *
 *   const [dialog, confirm] = useConfirm();
 *   if (await confirm({ title: "…", confirmLabel: "Send" })) …
 *   return <>{dialog}…</>;
 */
export function useConfirm(): [ReactNode, (options: ConfirmOptions) => Promise<boolean>] {
  const [pending, setPending] = useState<Pending | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // showModal() moves focus to the dialog's first button (Cancel), so the
  // intended button is focused explicitly afterwards: Cancel for a
  // destructive action (Enter can't confirm it by accident), the confirm
  // button otherwise (Enter confirms).
  useEffect(() => {
    const dialog = ref.current;
    if (!pending || !dialog) return;
    if (!dialog.open) dialog.showModal();
    (pending.danger ? cancelRef : confirmRef).current?.focus();
  }, [pending]);

  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ ...options, resolve })),
    [],
  );

  function close(confirmed: boolean) {
    pending?.resolve(confirmed);
    ref.current?.close();
    setPending(null);
  }

  const dialog = pending ? (
    <dialog
      ref={ref}
      aria-labelledby="confirm-title"
      onCancel={(e) => {
        e.preventDefault();
        close(false);
      }}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-zinc-200 bg-white p-5 text-zinc-900 shadow-xl dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
    >
      <h2 id="confirm-title" className="text-base font-semibold">
        {pending.title}
      </h2>
      {pending.body && <div className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">{pending.body}</div>}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button ref={cancelRef} type="button" onClick={() => close(false)} className="btn-secondary">
          Cancel
        </button>
        <button
          ref={confirmRef}
          type="button"
          onClick={() => close(true)}
          className={pending.danger ? "btn-danger-solid" : "btn-primary"}
        >
          {pending.confirmLabel}
        </button>
      </div>
    </dialog>
  ) : null;

  return [dialog, confirm];
}
