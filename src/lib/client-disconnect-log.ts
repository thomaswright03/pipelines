// Next.js 16.3 streams each page and refresh with React's Node renderer.
// When the browser stops reading a response before it ends — the operator
// stops a bulk send and the page refreshes, or leaves the page mid-refresh —
// React cancels the render with `Error("The destination stream closed
// early.")`. Next skips only errors named AbortError, so it logs this one as
// "⨯ Error: The destination stream closed early." with a digest, though
// nothing failed: the browser just stopped listening. That line in the logs
// hides real errors, so this drops exactly it and passes everything else
// through untouched. Installed at server start (src/instrumentation.ts).
// Remove once Next treats the cancel as an abort.

export const CLIENT_DISCONNECT_MESSAGE = "The destination stream closed early.";

/** True for a log line whose error is only React's "the browser went away". */
export function isClientDisconnectLog(args: readonly unknown[]): boolean {
  return args.some((a) => a instanceof Error && a.message === CLIENT_DISCONNECT_MESSAGE);
}

const INSTALLED = Symbol.for("pipelines.muteClientDisconnectLogs");

/** Wraps `target.error` so client-disconnect lines are dropped. Safe to call twice. */
export function muteClientDisconnectLogs(target: Pick<Console, "error"> = console): void {
  const current = target.error as Console["error"] & { [INSTALLED]?: true };
  if (current[INSTALLED]) return;
  const wrapped = Object.assign(
    (...args: unknown[]) => {
      if (!isClientDisconnectLog(args)) current.apply(target, args);
    },
    { [INSTALLED]: true as const },
  );
  target.error = wrapped;
}
