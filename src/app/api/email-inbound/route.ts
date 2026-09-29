import type { NextRequest } from "next/server";
import { z } from "zod";
import { isAuthorizedBearer } from "@/lib/auth-header";
import { logError, logWarn } from "@/lib/log";
import { isDatabaseUnavailable } from "@/lib/db-health";
import { extractEmailAddress, handleInboundReply } from "@/lib/outreach/inbound";

// Receives a parsed inbound email from the Cloudflare Email Worker that
// catches replies to the outreach sender address (the Worker lives outside
// this repo). Cloudflare Email Routing has no webhook of its own — the
// Worker turns "someone replied" into this authenticated POST.
//
// Contract (docs/deployment.md → "Reply tracking"): every response carries `retry`.
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
  from: z
    .string()
    .trim()
    .min(3)
    .max(500)
    .refine((from) => extractEmailAddress(from) !== null, "no email address in it, like name@example.com"),
  subject: z.string().max(2_000).optional().nullable(),
  text: z.string().max(200_000).optional().nullable(),
  messageId: z.string().trim().max(1_000).optional().nullable(),
  headers: z
    .record(z.string().max(200), z.union([z.string().max(20_000), z.array(z.string().max(20_000)).max(50)]))
    .refine((h) => Object.keys(h).length <= 300, "Too many headers")
    .optional()
    .nullable(),
});

const EXPECTED_BODY = "{ from, subject, text, messageId, headers }";

/** What was wrong with a rejected payload, by field name only — never its content. */
function describeIssues(error: z.ZodError): { fields: string[]; message: string } {
  const problems = new Map<string, string>();
  for (const issue of error.issues) {
    const field = issue.path.length > 0 ? String(issue.path[0]) : "(body)";
    if (problems.has(field)) continue;
    const limit = "maximum" in issue ? ` (at most ${String(issue.maximum)}${issue.origin === "string" ? " characters" : ""})` : "";
    const problem =
      issue.code === "too_big"
        ? `is too long${limit}`
        : issue.code === "too_small"
          ? "is empty or too short"
          : `is invalid (${issue.message})`;
    problems.set(field, `${field} ${problem}`);
  }
  return { fields: [...problems.keys()], message: `Rejected: ${[...problems.values()].join("; ")}. Expected ${EXPECTED_BODY}.` };
}

/** A 400 that is also logged, so a Worker dropping replies (a missed opt-out, perhaps) shows up in the server log. */
function rejected(reason: string, message: string, context: Record<string, string>) {
  logWarn("api.email-inbound", `Rejected an inbound reply: ${reason}`, context);
  return Response.json({ error: message, retry: false }, { status: 400 });
}

export async function POST(request: NextRequest) {
  if (!isAuthorizedBearer(request.headers.get("authorization"), process.env.EMAIL_INBOUND_SECRET)) {
    return Response.json({ error: "Unauthorized", retry: false }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return rejected("body isn't JSON", `Body must be JSON: ${EXPECTED_BODY}`, {});
  }
  const parsed = inboundSchema.safeParse(payload);
  if (!parsed.success) {
    const { fields, message } = describeIssues(parsed.error);
    return rejected("invalid fields", message, { fields: fields.join(",") });
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
