import { formatCount } from "@/lib/format";

/**
 * A live "112 / 120 characters" count under a text field, shown once the
 * text reaches 80% of its limit, and in red with how far over once past it.
 * Fields show this instead of a native `maxLength`, which cuts pasted text
 * without saying so; the form's own check then refuses the over-long value
 * with the field's "can be at most N characters" error.
 */
export default function CharacterCount({ id, value, limit }: { id: string; value: string; limit: number }) {
  const length = value.trim().length;
  const near = length >= limit * 0.8;
  const over = length - limit;
  return (
    <p id={id} aria-live="polite" className={`text-xs ${over > 0 ? "font-medium text-red-700 dark:text-red-300" : "muted"}`}>
      {near && (
        <>
          {formatCount(length)} / {formatCount(limit)} characters
          {over > 0 && ` — ${formatCount(over)} over the limit`}
        </>
      )}
    </p>
  );
}
