import type { NextRequest } from "next/server";
import { z } from "zod";
import { isAuthorizedBearer } from "@/lib/auth-header";
import { describeError, logError } from "@/lib/log";
import { handleInboundReply } from "@/lib/outreach/inbound";

// Receives a parsed inbound email from the Cloudflare Email Worker that
// catches replies to the outreach sender address (the Worker lives outside
// this repo). Cloudflare Email Routing has no webhook of its own — the
// Worker turns "someone replied" into this authenticated POST.
const inboundSchema = z.object({
  from: z.string().trim().min(3).max(500),
  subject: z.string().max(2_000).optional().nullable(),
  text: z.string().max(200_000).optional().nullable(),
});

export async function POST(request: NextRequest) {
  if (!isAuthorizedBearer(request.headers.get("authorization"), process.env.EMAIL_INBOUND_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Body must be JSON: { from, subject, text }" }, { status: 400 });
  }
  const parsed = inboundSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Body must be JSON: { from, subject, text }" }, { status: 400 });
  }

  try {
    return Response.json(await handleInboundReply(parsed.data));
  } catch (err) {
    logError("api.email-inbound", err, { from: parsed.data.from });
    return Response.json({ error: "Couldn't record the reply", cause: describeError(err) }, { status: 500 });
  }
}
