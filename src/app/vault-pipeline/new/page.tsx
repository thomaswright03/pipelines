"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { createLeadAction, type LeadFormState } from "@/lib/actions/vault-pipeline";

const initialState: LeadFormState = {};

export default function NewLead() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(async (prev: LeadFormState, formData: FormData) => {
    const result = await createLeadAction(prev, formData);
    if (!result.error) router.push("/vault-pipeline");
    return result;
  }, initialState);

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="accent-text text-2xl font-bold tracking-tight">Add lead</h1>
      <form action={formAction} className="card mt-4 flex flex-col gap-3 p-5">
        <Input name="name" label="Name" required />
        <Input name="company" label="Company" />
        <Input name="email" label="Email" type="email" />
        <Input name="phone" label="Phone" />
        <Input name="address" label="Address" />
        <div className="grid grid-cols-2 gap-3">
          <Input name="city" label="City" />
          <Input name="state" label="State" />
        </div>
        <Input name="website" label="Website" />
        <Input name="source" label="Source" />
        <Input name="estimatedValue" label="Estimated value ($)" />
        <label className="flex flex-col gap-1 text-sm">
          Notes
          <textarea name="notes" rows={3} className="input" />
        </label>
        {state.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? "Saving…" : "Add lead"}
        </button>
      </form>
    </div>
  );
}

function Input({
  name,
  label,
  type = "text",
  required,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <input name={name} type={type} required={required} className="input" />
    </label>
  );
}
