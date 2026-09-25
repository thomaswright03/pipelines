// The database (Neon Postgres) is a network call — a single Prisma query
// can hit a transient blip ("fetch failed" / a dropped WebSocket) that
// would otherwise kill a whole run. Retry once after a short pause before
// giving up. Only for idempotent reads/writes (the city pickers use it).
export async function withRetry<T>(fn: () => Promise<T>, onRetry?: (err: unknown) => void): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    onRetry?.(err);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    return fn();
  }
}
