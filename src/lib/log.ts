// Server-side logging with enough context to debug from Vercel's logs:
// which route/action failed, for which lead or run, and the underlying
// cause (including nested `cause` chains and the WebSocket ErrorEvents the
// Neon driver throws, which otherwise print as an opaque `ErrorEvent {}`).

type LogContext = Record<string, string | number | boolean | null | undefined>;

/** Flattens any thrown value into a readable one-line description. */
export function describeError(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  for (let depth = 0; current !== undefined && current !== null && depth < 5; depth++) {
    if (current instanceof Error) {
      const code = (current as { code?: unknown }).code;
      parts.push(`${current.name}${code ? ` [${String(code)}]` : ""}: ${current.message}`);
      current = (current as { cause?: unknown }).cause;
    } else if (typeof current === "object") {
      // ErrorEvent-like objects from WebSocket drivers.
      const obj = current as { message?: unknown; error?: unknown; type?: unknown };
      if (typeof obj.message === "string" && obj.message) parts.push(obj.message);
      else if (typeof obj.type === "string") parts.push(`${obj.type} event`);
      else parts.push(safeStringify(current));
      current = obj.error;
    } else {
      parts.push(String(current));
      current = undefined;
    }
  }
  return parts.join(" <- caused by: ") || "Unknown error";
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

function format(scope: string, message: string, context: LogContext): string {
  const ctx = Object.entries(context)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  return `[${scope}] ${message}${ctx ? ` (${ctx})` : ""}`;
}

export function logError(scope: string, err: unknown, context: LogContext = {}): void {
  console.error(format(scope, describeError(err), context));
}

export function logWarn(scope: string, message: string, context: LogContext = {}): void {
  console.warn(format(scope, message, context));
}

export function logInfo(scope: string, message: string, context: LogContext = {}): void {
  console.info(format(scope, message, context));
}
