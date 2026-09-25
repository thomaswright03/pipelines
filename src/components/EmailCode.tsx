/**
 * An email address in <code> that never breaks inside itself: it stays on
 * one line and, when the line is full, wraps to the next as a whole.
 */
export default function EmailCode({ email }: { email: string }) {
  return <code className="inline-block whitespace-nowrap rounded bg-zinc-100 px-1 py-0.5 text-xs dark:bg-zinc-800">{email}</code>;
}
