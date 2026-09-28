// Tells "this site doesn't exist / has nothing here" apart from "we
// couldn't reach it just now". Only the first is a verdict about a lead:
// a timeout, a dropped connection or a 5xx from a site that was up
// yesterday says nothing about whether it lists an address.

export type FetchFailure =
  /** The domain doesn't resolve, or the server answered with a 4xx / non-page. */
  | "missing"
  /** Timeout, dropped or refused connection, TLS failure, 5xx or 429 — try again later. */
  | "unreachable";

/** How to read a response that wasn't a usable page. */
export function classifyStatus(status: number): FetchFailure {
  return status >= 500 || status === 429 ? "unreachable" : "missing";
}

/** How to read an exception thrown by fetch. */
export function classifyFetchError(err: unknown): FetchFailure {
  const e = err as { name?: string; code?: string; cause?: { code?: string } } | null;
  // Only "no such domain" is a definite answer; everything else (timeouts
  // and aborts included) means we didn't get to look.
  const code = e?.cause?.code ?? e?.code;
  return code === "ENOTFOUND" ? "missing" : "unreachable";
}
