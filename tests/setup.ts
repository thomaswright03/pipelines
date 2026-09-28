import { afterEach, beforeEach, vi } from "vitest";
import { resetDatabase } from "./helpers";

// Server actions call revalidatePath, which needs a Next request context.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

// No test may reach the network: anything a test doesn't stub fails loudly.
beforeEach(async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      throw new Error(`Unexpected network call in test: ${String(input)}`);
    }),
  );
  await resetDatabase();
});

afterEach(() => {
  vi.unstubAllGlobals();
  // Tests that set OUTBOUND_EMAIL_DISABLED (and the like) with vi.stubEnv.
  vi.unstubAllEnvs();
});
