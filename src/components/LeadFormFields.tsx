"use client";

import { useState, useTransition } from "react";
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
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function set(name: keyof T, value: string) {
    setValues((v) => ({ ...v, [name]: value }));
  }

  function checkField(name: keyof T) {
    const parsed = schema.safeParse(values);
    const fieldErrors: FieldErrors<T> = parsed.success ? {} : fieldErrorsOf<T>(parsed.error);
    setErrors((e) => ({ ...e, [name]: fieldErrors[name] }));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrorsOf<T>(parsed.error));
      setFormError("Fix the highlighted fields.");
      return;
    }
    setErrors({});
    setFormError(null);
    startTransition(async () => {
      try {
        const result = await submit(values);
        if (result.ok && result.leadId) {
          onSaved(result.leadId);
          return;
        }
        setErrors(result.fieldErrors ?? {});
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
      onChange: (value: string) => set(name, value),
      onBlur: () => checkField(name),
    };
  }

  return { values, set, field, onSubmit, isPending, formError };
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
  maxLength,
  placeholder,
  hint,
  inputMode,
  autoComplete,
}: {
  label: string;
  name: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  type?: string;
  required?: boolean;
  maxLength?: number;
  placeholder?: string;
  hint?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  autoComplete?: string;
}) {
  const id = `field-${name}`;
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined;
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
        maxLength={maxLength}
        placeholder={placeholder}
        inputMode={inputMode}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className="input"
      />
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="field-error">
          {error}
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
  maxLength,
}: {
  label: string;
  name: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  maxLength?: number;
}) {
  const id = `field-${name}`;
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
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className="input"
      />
      {error && (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
