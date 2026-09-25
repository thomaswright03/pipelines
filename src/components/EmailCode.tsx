import { Fragment } from "react";

/**
 * An email address in <code> that never splits inside a word: on a narrow
 * screen it may wrap only after the "@" or a ".".
 */
export default function EmailCode({ email }: { email: string }) {
  const parts = email.split(/(?<=[@.])/);
  return (
    <code className="whitespace-nowrap rounded bg-zinc-100 px-1 py-0.5 text-xs dark:bg-zinc-800">
      {parts.map((part, i) => (
        <Fragment key={i}>
          {part}
          {i < parts.length - 1 && <wbr />}
        </Fragment>
      ))}
    </code>
  );
}
