// The outcome line under a set of actions: green for done, red for
// refused/failed. Announced to screen readers when it changes.
export type Feedback = { ok: boolean; text: string } | null;

export default function ActionMessage({ feedback }: { feedback: Feedback }) {
  return (
    <div aria-live="polite" role="status">
      {feedback && <p className={feedback.ok ? "notice-success" : "notice-error"}>{feedback.text}</p>}
    </div>
  );
}
