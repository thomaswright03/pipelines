// Reference Cloudflare Email Worker for reply tracking. Cloudflare Email
// Routing sends every message addressed to the outreach sender to this
// Worker, which turns it into the authenticated POST the app records it
// from (src/app/api/email-inbound/route.ts; contract in README → "Reply
// tracking"):
//
// - The message's From, Subject, plain text, Message-ID and all headers are
//   sent, so a re-delivered reply is recognised (messageId) and automatic
//   replies and bounces are recognised by their headers.
// - 2xx: recorded. 400/401 (and other 4xx except 408/429): the request is
//   wrong and resending won't help — logged, not retried.
// - 5xx, 408, 429 or no response: nothing was recorded. The payload goes on
//   a Cloudflare Queue and is resent with exponential backoff (1 min,
//   doubling, capped at 1 hour) for 72 hours, then logged as an alert.
//   Resending is always safe: the app records a reply once.
// - Optionally, the original message is also forwarded to a mailbox
//   (FORWARD_TO), so the owner still sees replies in their inbox.
//
// Configuration (wrangler.toml.example): INBOUND_URL, EMAIL_INBOUND_SECRET
// (the app's secret), VERCEL_BYPASS_SECRET (Vercel "Protection Bypass for
// Automation"; omit if the deployment isn't protected), FORWARD_TO, and the
// RETRY_QUEUE producer/consumer binding.
//
// tests/worker-contract.test.ts runs this Worker against the real route.
import { firstHeader, parseMessage, type ParsedHeaders } from "./mime";

// --- The minimal Cloudflare runtime surface this Worker uses -------------

export type EmailMessage = {
  readonly from: string;
  readonly to: string;
  readonly raw: ReadableStream<Uint8Array>;
  forward(rcptTo: string): Promise<void>;
};

export type QueueMessage<Body> = {
  readonly body: Body;
  readonly attempts: number;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
};

export type Queue<Body> = { send(body: Body, options?: { delaySeconds?: number }): Promise<void> };

export type Env = {
  INBOUND_URL: string;
  EMAIL_INBOUND_SECRET: string;
  VERCEL_BYPASS_SECRET?: string;
  FORWARD_TO?: string;
  RETRY_QUEUE: Queue<QueuedReply>;
};

// --- The payload -----------------------------------------------------------

export type InboundPayload = {
  from: string;
  subject: string | null;
  text: string;
  messageId: string | null;
  headers: Record<string, string | string[]>;
};

export type QueuedReply = { payload: InboundPayload; firstAttemptAt: number };

// The route's own limits (inboundSchema): a payload over them is refused
// with a 400 and the reply would be lost, so they are applied here.
const MAX_TEXT = 200_000;
const MAX_HEADERS = 300;
const MAX_HEADER_VALUE = 20_000;
const MAX_HEADER_REPEATS = 50;
const MAX_SUBJECT = 2_000;
const MAX_FROM = 500;
const MAX_MESSAGE_ID = 1_000;

/** Headers the app reads; the only ones kept when a payload must be shrunk to fit a queue message. */
export const APP_HEADERS = [
  "auto-submitted",
  "x-autoreply",
  "x-autorespond",
  "x-autoresponder",
  "precedence",
  "x-auto-response-suppress",
  "x-failed-recipients",
  "content-type",
];

function headersObject(headers: ParsedHeaders, only?: string[]): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  let count = 0;
  for (const [key, { name, values }] of headers) {
    if (only && !only.includes(key)) continue;
    if (count >= MAX_HEADERS || name.length > 200) continue;
    const trimmed = values.slice(0, MAX_HEADER_REPEATS).map((v) => v.slice(0, MAX_HEADER_VALUE));
    out[name] = trimmed.length === 1 ? trimmed[0]! : trimmed;
    count++;
  }
  return out;
}

/** Builds the route's payload from a raw message; `envelopeFrom` is used when there is no From header. */
export function buildPayload(raw: Uint8Array, envelopeFrom: string): InboundPayload {
  const { headers, text } = parseMessage(raw);
  const from = (firstHeader(headers, "from") || envelopeFrom).slice(0, MAX_FROM);
  return {
    from: from.trim().length >= 3 ? from : envelopeFrom,
    subject: firstHeader(headers, "subject")?.slice(0, MAX_SUBJECT) ?? null,
    text: text.slice(0, MAX_TEXT),
    messageId: firstHeader(headers, "message-id")?.trim().slice(0, MAX_MESSAGE_ID) || null,
    headers: headersObject(headers),
  };
}

/** Cloudflare Queues take messages up to 128 KB; shrink a payload to fit with room to spare. */
export function fitForQueue(payload: InboundPayload, limitBytes = 120_000): InboundPayload {
  const size = (p: InboundPayload) => new TextEncoder().encode(JSON.stringify(p)).length;
  if (size(payload) <= limitBytes) return payload;
  const keptHeaders: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(payload.headers)) {
    if (APP_HEADERS.includes(name.toLowerCase())) keptHeaders[name] = value;
  }
  let smaller: InboundPayload = { ...payload, headers: keptHeaders };
  // The replier's own words come first; quoted history below is what gets cut.
  while (size(smaller) > limitBytes && smaller.text.length > 1_000) {
    smaller = { ...smaller, text: smaller.text.slice(0, Math.floor(smaller.text.length * 0.7)) };
  }
  return smaller;
}

// --- Delivery --------------------------------------------------------------

export type DeliveryOutcome = {
  /** delivered: recorded (or already recorded). rejected: resending won't help. retry: resend later. */
  outcome: "delivered" | "rejected" | "retry";
  status: number | null;
  detail: string;
};

type Fetch = (input: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<Response>;

/** POSTs one payload to the app and says what to do next. */
export async function deliver(payload: InboundPayload, env: Env, fetchImpl: Fetch = fetch): Promise<DeliveryOutcome> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${env.EMAIL_INBOUND_SECRET}`,
    "content-type": "application/json",
  };
  if (env.VERCEL_BYPASS_SECRET) headers["x-vercel-protection-bypass"] = env.VERCEL_BYPASS_SECRET;
  let response: Response;
  try {
    response = await fetchImpl(env.INBOUND_URL, { method: "POST", headers, body: JSON.stringify(payload) });
  } catch (err) {
    return { outcome: "retry", status: null, detail: `no response: ${String(err)}` };
  }
  const detail = (await response.text().catch(() => "")).slice(0, 500);
  if (response.ok) return { outcome: "delivered", status: response.status, detail };
  if (response.status >= 500 || response.status === 408 || response.status === 429) {
    return { outcome: "retry", status: response.status, detail };
  }
  return { outcome: "rejected", status: response.status, detail };
}

/** How long to wait before resend number `attempt` (1-based): 1 min, doubling, capped at 1 hour. */
export function retryDelaySeconds(attempt: number): number {
  return Math.min(60 * 2 ** Math.max(0, attempt - 1), 3_600);
}

/** How long a reply keeps being resent before the Worker gives up and logs an alert. */
export const RETRY_WINDOW_MS = 72 * 3_600_000;

function describe(payload: InboundPayload): string {
  return `from=${JSON.stringify(payload.from)} messageId=${JSON.stringify(payload.messageId)}`;
}

/** Handles one inbound message: send it to the app now, or queue it for a resend. */
export async function handleEmail(message: EmailMessage, env: Env, fetchImpl: Fetch = fetch, now: () => number = Date.now) {
  const raw = new Uint8Array(await new Response(message.raw).arrayBuffer());
  const payload = buildPayload(raw, message.from);
  if (env.FORWARD_TO) {
    // Best-effort: the reply is recorded in the app either way.
    await message.forward(env.FORWARD_TO).catch((err: unknown) => console.error(`forward to FORWARD_TO failed: ${String(err)}`));
  }
  const result = await deliver(payload, env, fetchImpl);
  if (result.outcome === "retry") {
    console.warn(`app didn't record the reply (${result.status ?? "no response"}); queued for resend: ${describe(payload)}`);
    await env.RETRY_QUEUE.send({ payload: fitForQueue(payload), firstAttemptAt: now() }, { delaySeconds: retryDelaySeconds(1) });
  } else if (result.outcome === "rejected") {
    console.error(`app refused the reply (${result.status}): ${result.detail} ${describe(payload)}`);
  }
  return result;
}

/** Resends queued replies, backing off until they're recorded or the 72-hour window ends. */
export async function handleQueue(
  messages: readonly QueueMessage<QueuedReply>[],
  env: Env,
  fetchImpl: Fetch = fetch,
  now: () => number = Date.now,
) {
  for (const message of messages) {
    const { payload, firstAttemptAt } = message.body;
    const result = await deliver(payload, env, fetchImpl);
    if (result.outcome === "delivered") {
      message.ack();
    } else if (result.outcome === "rejected") {
      console.error(`app refused a queued reply (${result.status}): ${result.detail} ${describe(payload)}`);
      message.ack();
    } else if (now() - firstAttemptAt >= RETRY_WINDOW_MS) {
      console.error(`ALERT: reply not recorded after 72 hours of resending; mark it by hand. ${describe(payload)}`);
      message.ack();
    } else {
      message.retry({ delaySeconds: retryDelaySeconds(message.attempts + 1) });
    }
  }
}

const worker = {
  async email(message: EmailMessage, env: Env): Promise<void> {
    await handleEmail(message, env);
  },
  async queue(batch: { messages: readonly QueueMessage<QueuedReply>[] }, env: Env): Promise<void> {
    await handleQueue(batch.messages, env);
  },
};

export default worker;
