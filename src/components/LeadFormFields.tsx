"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useConfirm } from "@/components/ConfirmDialog";
import CharacterCount from "@/components/CharacterCount";
import type { z } from "zod";
import { fieldErrorsOf, type FieldErrors, type FormState } from "@/lib/lead-forms";

/**
 * Controlled form state for the "add lead/agent" forms: values survive a
 * failed save, each field shows its own error (checked in the browser on
 * blur and on submit with the same rules the server applies), and the
 * server's verdict is shown the same way.
 */
export function useLeadForm<T extends Record<string, string>>(
  schema: z.ZodType<unknown, T>,
  initial: T,
  submit: (values: T) => Promise<FormState<T> & { leadId?: string }>,
  onSaved: (leadId: string) => void,
) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<FieldErrors<T>>({});
  type Links = NonNullable<FormState<T>["fieldLinks"]>;
  const [links, setLinks] = useState<Links>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const dirty = !saved && (Object.keys(initial) as (keyof T)[]).some((k) => values[k] !== initial[k]);
  const guardDialog = useUnsavedChangesGuard(dirty);

  function set(name: keyof T, value: string) {
    setValues((v) => ({ ...v, [name]: value }));
  }

  // Typing in a field clears its error straight away, so the message (and
  // the layout) doesn't jump when focus later leaves the field — e.g. on
  // the way to the Save button.
  function change(name: keyof T, value: string) {
    set(name, value);
    setErrors((e) => (e[name] ? { ...e, [name]: undefined } : e));
    setLinks((l) => (l[name] ? ({ ...l, [name]: undefined } as Links) : l));
  }

  function checkField(name: keyof T) {
    const parsed = schema.safeParse(values);
    const fieldErrors: FieldErrors<T> = parsed.success ? {} : fieldErrorsOf<T>(parsed.error);
    setErrors((e) => ({ ...e, [name]: fieldErrors[name] }));
    setLinks((l) => ({ ...l, [name]: undefined }) as Links);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrorsOf<T>(parsed.error));
      setLinks({});
      setFormError("Fix the highlighted fields.");
      return;
    }
    setErrors({});
    setLinks({});
    setFormError(null);
    startTransition(async () => {
      try {
        const result = await submit(values);
        if (result.ok && result.leadId) {
          setSaved(true);
          onSaved(result.leadId);
          return;
        }
        setErrors(result.fieldErrors ?? {});
        setLinks(result.fieldLinks ?? {});
        setFormError(result.error ?? "Couldn't save — try again.");
      } catch {
        setFormError("Couldn't reach the server — nothing was saved. Check your connection and try again.");
      }
    });
  }

  function field(name: keyof T & string) {
    return {
      name,
      value: values[name],
      error: errors[name],
      errorLink: links[name],
      onChange: (value: string) => change(name, value),
      onBlur: () => checkField(name),
    };
  }

  return { values, set, field, onSubmit, isPending, formError, dirty, guardDialog };
}

/**
 * While `dirty`, leaving the page asks first: closing or reloading the tab
 * gets the browser's own prompt, and following a link inside the app gets a
 * "Leave without saving?" dialog. Returns the dialog to render.
 *
 * The browser's Back button isn't intercepted: the app router owns history
 * navigation, and trapping it reliably isn't possible without breaking it.
 */
function useUnsavedChangesGuard(dirty: boolean): ReactNode {
  const router = useRouter();
  const [dialog, confirm] = useConfirm();

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ""; // older browsers need this to show the prompt
    };
    // Capture phase, so this runs before the Link's own click handler.
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || (anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return; // a full page load: the browser's prompt covers it
      if (url.pathname === window.location.pathname && url.search === window.location.search) return; // same page
      e.preventDefault();
      e.stopPropagation();
      void confirm({
        title: "Leave without saving?",
        body: <p>Your changes to this form haven&apos;t been saved and will be lost.</p>,
        confirmLabel: "Leave without saving",
        danger: true,
      }).then((leave) => {
        if (leave) router.push(`${url.pathname}${url.search}${url.hash}`);
      });
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty, confirm, router]);

  return dialog;
}

export function TextField({
  label,
  name,
  value,
  error,
  onChange,
  onBlur,
  type = "text",
  required,
  limit,
  placeholder,
  hint,
  inputMode,
  autoComplete,
  errorLink,
}: {
  label: string;
  name: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  type?: string;
  required?: boolean;
  /** The most characters the field takes. A live count appears near it; no native maxLength, which cuts pasted text silently. */
  limit?: number;
  placeholder?: string;
  hint?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  autoComplete?: string;
  /** A link shown under the error (e.g. to the lead that already has this address). */
  errorLink?: { href: string; label: string };
}) {
  const id = `field-${name}`;
  const describedBy =
    [error ? `${id}-error` : null, hint ? `${id}-hint` : null, limit ? `${id}-count` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="field-label">
        <span>
          {label}
          {required && <span aria-hidden> *</span>}
        </span>
      </label>
      <input
        id={id}
        name={name}
        type={type}
        value={value}
        required={required}
        placeholder={placeholder}
        inputMode={inputMode}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className="input"
      />
      {limit && <CharacterCount id={`${id}-count`} value={value} limit={limit} />}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-sm muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="field-error">
          {error}
          {errorLink && (
            <>
              {" "}
              <Link href={errorLink.href} className="font-medium underline underline-offset-2">
                {errorLink.label}
              </Link>
            </>
          )}
        </p>
      )}
    </div>
  );
}

export function TextAreaField({
  label,
  name,
  value,
  error,
  onChange,
  onBlur,
  limit,
}: {
  label: string;
  name: string;
  value: string;
  error?: string;
  errorLink?: { href: string; label: string };
  onChange: (value: string) => void;
  onBlur: () => void;
  /** As TextField's `limit`. */
  limit?: number;
}) {
  const id = `field-${name}`;
  const describedBy = [error ? `${id}-error` : null, limit ? `${id}-count` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <textarea
        id={id}
        name={name}
        rows={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className="input"
      />
      {limit && <CharacterCount id={`${id}-count`} value={value} limit={limit} />}
      {error && (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
