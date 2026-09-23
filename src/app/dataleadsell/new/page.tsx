"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { createAgentAction, type AgentFormState } from "@/lib/actions/dataleadsell";

const initialState: AgentFormState = {};

export default function NewAgentLead() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(async (prev: AgentFormState, formData: FormData) => {
    const result = await createAgentAction(prev, formData);
    if (!result.error) router.push("/dataleadsell");
    return result;
  }, initialState);

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="accent-text text-2xl font-bold tracking-tight">Add agent</h1>
      <form action={formAction} className="card mt-4 flex flex-col gap-3 p-5">
        <Input name="name" label="Name" required />
        <Input name="brokerage" label="Brokerage" />
        <Input name="email" label="Email" type="email" />
        <Input name="phone" label="Phone" />
        <div className="grid grid-cols-3 gap-3">
          <Input name="city" label="City" />
          <Input name="county" label="County" />
          <Input name="state" label="State" />
        </div>
        <Input name="website" label="Website" />
        <label className="flex flex-col gap-1 text-sm">
          Notes
          <textarea name="notes" rows={3} className="input" />
        </label>
        {state.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? "Saving…" : "Add agent"}
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
