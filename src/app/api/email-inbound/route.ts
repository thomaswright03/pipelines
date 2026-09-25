import type { NextRequest } from "next/server";
import { z } from "zod";
import { isAuthorizedBearer } from "@/lib/auth-header";
import { logError } from "@/lib/log";
import { handleInboundReply } from "@/lib/outreach/inbound";

// Receives a parsed inbound email from the Cloudflare Email Worker that
// catches replies to the outreach sender address (the Worker lives outside
// this repo). Cloudflare Email Routing has no webhook of its own — the
// Worker turns "someone replied" into this authenticated POST.
//
// Contract (README → "Reply tracking"): every response carries `retry`.
// 2xx: recorded (or already recorded — `duplicate: true`); don't resend.
// 400 / 401: the request itself is wrong; resending won't help.
// 503: nothing was recorded (e.g. the database is unreachable); the Worker
// must resend the same payload with backoff. Recording is idempotent, so a
// resend is always safe. The body is { error, code: "db_unavailable" |
// "internal", retry: true } — the underlying cause goes to the server log
// only.
//
// `headers` is optional: the message's headers as { name: value } (or
// value[] for a repeated header). With them, automatic replies and bounce
// notices are recognised by their standard headers (Auto-Submitted,
// X-Autoreply, Precedence, X-Failed-Recipients…) rather than by wording.
const inboundSchema = z.object({
  from: z.string().trim().min(3).max(500),
  subject: z.string().max(2_000).optional().nullable(),
  text: z.string().max(200_000).optional().nullable(),
  messageId: z.string().trim().max(1_000).optional().nullable(),
  headers: z
    .record(z.string().max(200), z.union([z.string().max(20_000), z.array(z.string().max(20_000)).max(50)]))
    .refine((h) => Object.keys(h).length <= 300, "Too many headers")
    .optional()
    .nullable(),
});

const BAD_BODY = "Body must be JSON: { from, subject, text, messageId, headers }";

/** Prisma's "can't reach the database" family (P1001 and friends), or a dropped connection. */
function isDatabaseUnavailable(err: unknown): boolean {
  const code = (err as { code?: unknown; errorCode?: unknown } | null)?.code ?? (err as { errorCode?: unknown } | null)?.errorCode;
  if (typeof code === "string" && /^P10(?:0[1-2]|17)$|^ECONNREFUSED$|^ETIMEDOUT$|^ENOTFOUND$/.test(code)) return true;
  const name = (err as { name?: unknown } | null)?.name;
  return name === "PrismaClientInitializationError" || /can't reach database|connection (?:refused|terminated)|ECONNREFUSED/i.test(String(err));
}

export async function POST(request: NextRequest) {
  if (!isAuthorizedBearer(request.headers.get("authorization"), process.env.EMAIL_INBOUND_SECRET)) {
    return Response.json({ error: "Unauthorized", retry: false }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: BAD_BODY, retry: false }, { status: 400 });
  }
  const parsed = inboundSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: BAD_BODY, retry: false }, { status: 400 });
  }

  try {
    return Response.json({ ...(await handleInboundReply(parsed.data)), retry: false });
  } catch (err) {
    const code = isDatabaseUnavailable(err) ? "db_unavailable" : "internal";
    logError("api.email-inbound", err, { from: parsed.data.from, code });
    return Response.json(
      { error: "Couldn't record the reply — nothing was saved. Resend it.", code, retry: true },
      { status: 503, headers: { "Retry-After": "60" } },
    );
  }
}
