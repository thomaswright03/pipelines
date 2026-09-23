// Turso is a remote call now, not a local file — a single Prisma call can
// hit a transient network blip (confirmed in practice: "TypeError: fetch
// failed" killed pipeline runs outright). Retry once after a short pause
// before giving up.
export async function withRetry<T>(fn: () => Promise<T>, onRetry?: (err: unknown) => void): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    onRetry?.(err);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    return fn();
  }
}
