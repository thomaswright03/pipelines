// The outcome line under a set of actions: green for done, red for
// refused/failed. Announced to screen readers when it changes.
export type Feedback = { ok: boolean; text: string } | null;

/**
 * What to say when a server action call throws in the browser: the request
 * or its answer was lost on the way, so whether the server acted (an email
 * may already have gone out) is unknown. Never claims that nothing changed.
 * `what` completes "couldn't confirm whether …", e.g. "the change went through".
 */
export function unconfirmedMessage(what: string): string {
  return `Lost the connection to the server, so we couldn't confirm whether ${what}. Reload the page to see the current state before trying again.`;
}

export default function ActionMessage({ feedback }: { feedback: Feedback }) {
  return (
    // While empty it is taken out of the layout (so it adds no gap between
    // cards) but stays in the page, so the message is still announced.
    <div aria-live="polite" role="status" className="empty:absolute">
      {feedback && <p className={feedback.ok ? "notice-success" : "notice-error"}>{feedback.text}</p>}
    </div>
  );
}
