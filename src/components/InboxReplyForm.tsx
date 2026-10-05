"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendInboxReplyAction } from "@/lib/actions/outreach";
import type { PipelineId } from "@/lib/outreach/pipeline-id";
import { REPLY_MAX_LENGTH } from "@/lib/lead-forms";
import ActionMessage, { type Feedback } from "@/components/ActionMessage";

// "Reply" on a row of the Replied folder of Sent & replies: a box to write back to
// that person, sent by the app from the pipeline's address in the same thread.
export default function InboxReplyForm({
  pipeline,
  replyId,
  to,
  subject,
  disabledReason,
}: {
  pipeline: PipelineId;
  replyId: string;
  to: string;
  subject: string;
  /** Why this reply can't be answered from here (e.g. the address opted out); the button is disabled. */
  disabledReason?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<Feedback>(null);

  function send() {
    setFeedback(null);
    startTransition(async () => {
      try {
        const result = await sendInboxReplyAction(pipeline, replyId, body);
        if (result.ok) {
          setFeedback({ ok: true, text: result.message });
          setBody("");
          setOpen(false);
        } else {
          setFeedback({ ok: false, text: result.error });
        }
      } catch {
        setFeedback({
          ok: false,
          text: "Couldn't reach the server, so the reply may not have been sent. Check the lead's history before trying again.",
        });
      }
      router.refresh();
    });
  }

  if (disabledReason) return <p className="text-xs muted">{disabledReason}</p>;

  return (
    <div className="flex flex-col gap-2">
      {!open ? (
        <div>
          <button type="button" className="btn-secondary text-xs" onClick={() => setOpen(true)}>
            Reply
          </button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <p className="text-xs muted">
            To {to} · {subject}
          </p>
          <label className="sr-only" htmlFor={`reply-${replyId}`}>
            Your reply to {to}
          </label>
          <textarea
            id={`reply-${replyId}`}
            className="input min-h-28"
            value={body}
            maxLength={REPLY_MAX_LENGTH}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your reply…"
            autoFocus
          />
          <div className="flex gap-2">
            <button type="submit" className="btn-primary text-xs" disabled={isPending || !body.trim()}>
              {isPending ? "Sending…" : "Send reply"}
            </button>
            <button type="button" className="btn-ghost text-xs" disabled={isPending} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      <ActionMessage feedback={feedback} />
    </div>
  );
}
