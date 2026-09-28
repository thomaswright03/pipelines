// The outcome line under a set of actions: green for done, red for
// refused/failed. Announced to screen readers when it changes.
export type Feedback = { ok: boolean; text: string } | null;

export default function ActionMessage({ feedback }: { feedback: Feedback }) {
  return (
    // While empty it is taken out of the layout (so it adds no gap between
    // cards) but stays in the page, so the message is still announced.
    <div aria-live="polite" role="status" className="empty:absolute">
      {feedback && <p className={feedback.ok ? "notice-success" : "notice-error"}>{feedback.text}</p>}
    </div>
  );
}
