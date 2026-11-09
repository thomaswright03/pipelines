"use client";

// Settings → Connections "Test connection": proves a service's credentials
// work (mail: log in without sending) and shows the
// result in plain words. The list above re-reads the stored result.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { testConnectionAction } from "@/lib/actions/settings";
import ActionMessage, { type Feedback } from "@/components/ActionMessage";

export default function TestConnectionButton({ service, label }: { service: "mail"; label: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<Feedback>(null);

  function test() {
    setFeedback(null);
    startTransition(async () => {
      try {
        const result = await testConnectionAction(service);
        setFeedback(result.ok ? { ok: true, text: result.message } : { ok: false, text: result.error });
      } catch {
        setFeedback({ ok: false, text: "Couldn't reach the app's server to run the test. Check your connection and try again." });
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        <button type="button" className="btn-secondary" onClick={test} disabled={isPending} aria-label={`Test connection: ${label}`}>
          {isPending ? "Testing…" : "Test connection"}
        </button>
      </div>
      <ActionMessage feedback={feedback} />
    </div>
  );
}
