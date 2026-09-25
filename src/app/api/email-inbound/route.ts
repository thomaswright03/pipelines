import type { NextRequest } from "next/server";
import { z } from "zod";
import { isAuthorizedBearer } from "@/lib/auth-header";
import { describeError, logError } from "@/lib/log";
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
// resend is always safe.
const inboundSchema = z.object({
  from: z.string().trim().min(3).max(500),
  subject: z.string().max(2_000).optional().nullable(),
  text: z.string().max(200_000).optional().nullable(),
  messageId: z.string().trim().max(1_000).optional().nullable(),
});

const BAD_BODY = "Body must be JSON: { from, subject, text, messageId }";

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
    logError("api.email-inbound", err, { from: parsed.data.from });
    return Response.json(
      { error: "Couldn't record the reply — nothing was saved. Resend it.", cause: describeError(err), retry: true },
      { status: 503, headers: { "Retry-After": "60" } },
    );
  }
}
