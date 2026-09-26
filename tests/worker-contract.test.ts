// The reply-tracking Email Worker (workers/email-inbound) against the real
// /api/email-inbound route: what it sends (headers, messageId, the
// protection-bypass header), how it reads real MIME, and the retry
// contract — resend on 503 or no response with backoff, never on 400/401,
// and give up with an alert after 72 hours.
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { POST } from "@/app/api/email-inbound/route";
import { getPipeline } from "@/lib/outreach/pipelines";
import {
  buildPayload,
  deliver,
  fitForQueue,
  handleEmail,
  handleQueue,
  retryDelaySeconds,
  RETRY_WINDOW_MS,
  type Env,
  type QueuedReply,
  type QueueMessage,
} from "../workers/email-inbound/src/index";
import { makeColdLead } from "./helpers";

const INBOUND_URL = "https://pipelines.test/api/email-inbound";

/** Routes the Worker's fetch to the app's route handler, recording what was sent. */
function appFetch() {
  const requests: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fetchImpl = vi.fn(async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
    requests.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return POST(new NextRequest(url, init));
  });
  return { fetchImpl, requests };
}

function makeEnv(overrides: Partial<Env> = {}) {
  const sent: { body: QueuedReply; options?: { delaySeconds?: number } }[] = [];
  const env: Env = {
    INBOUND_URL,
    EMAIL_INBOUND_SECRET: "test-inbound-secret",
    VERCEL_BYPASS_SECRET: "bypass-123",
    RETRY_QUEUE: {
      async send(body, options) {
        sent.push({ body, options });
      },
    },
    ...overrides,
  };
  return { env, sent };
}

function raw(lines: string[]): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(lines.join("\r\n"));
}

function emailMessage(bytes: Uint8Array, from = "envelope@sender.test") {
  const forwarded: string[] = [];
  return {
    forwarded,
    message: {
      from,
      to: "thomas@wright-ai-solutions.com",
      raw: new Response(bytes as Uint8Array<ArrayBuffer>).body!,
      async forward(to: string) {
        forwarded.push(to);
      },
    },
  };
}

function queueMessage(body: QueuedReply, attempts = 1) {
  const calls = { acked: false, retried: null as null | { delaySeconds?: number } };
  const message: QueueMessage<QueuedReply> = {
    body,
    attempts,
    ack: () => void (calls.acked = true),
    retry: (options) => void (calls.retried = options ?? {}),
  };
  return { message, calls };
}

const REPLY = raw([
  "From: =?utf-8?Q?Jos=C3=A9_Prospect?= <jose@shop.test>",
  "To: thomas@wright-ai-solutions.com",
  "Subject: =?utf-8?B?UmU6IFF1aWNrIHF1ZXN0aW9u?=",
  "Message-ID: <reply-1@mail.shop.test>",
  "MIME-Version: 1.0",
  'Content-Type: multipart/alternative; boundary="b1"',
  "",
  "--b1",
  "Content-Type: text/plain; charset=utf-8",
  "Content-Transfer-Encoding: quoted-printable",
  "",
  "Yes, interested =E2=80=94 what does it cost?",
  "",
  "On Tue, Sep 22, 2026 Thomas Wright wrote:",
  "> Reply STOP and we won't email you again.",
  "--b1",
  "Content-Type: text/html; charset=utf-8",
  "",
  "<p>Yes, interested &mdash; what does it cost?</p>",
  "--b1--",
  "",
]);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the Worker reads real MIME", () => {
  it("decodes encoded headers, quoted-printable text and keeps every header", () => {
    const payload = buildPayload(REPLY, "bounce@shop.test");
    expect(payload).toMatchObject({
      from: "José Prospect <jose@shop.test>",
      subject: "Re: Quick question",
      messageId: "<reply-1@mail.shop.test>",
    });
    expect(payload.text).toMatch(/^Yes, interested — what does it cost\?/);
    expect(payload.headers).toMatchObject({ "Message-ID": "<reply-1@mail.shop.test>", "MIME-Version": "1.0" });
  });

  it("falls back to the HTML part, and to the envelope sender without a From header", () => {
    const payload = buildPayload(
      raw([
        "Subject: hi",
        "Content-Type: text/html; charset=iso-8859-1",
        "Content-Transfer-Encoding: base64",
        "",
        btoa("<p>Caf\xe9?<br>Yes</p>"),
      ]),
      "someone@shop.test",
    );
    expect(payload).toMatchObject({ from: "someone@shop.test", text: "Café?\nYes", messageId: null });
  });

  it("shrinks an oversized payload for the retry queue, keeping the headers the app reads", () => {
    const big = { ...buildPayload(REPLY, "x@y.test"), text: "a".repeat(300_000) };
    big.headers = { ...big.headers, "Auto-Submitted": "auto-replied", "X-Junk": "b".repeat(20_000) };
    const small = fitForQueue(big);
    expect(new TextEncoder().encode(JSON.stringify(small)).length).toBeLessThanOrEqual(120_000);
    expect(small.headers).toEqual({ "Auto-Submitted": "auto-replied", "Content-Type": 'multipart/alternative; boundary="b1"' });
    expect(small.messageId).toBe(big.messageId);
  });
});

describe("the Worker against /api/email-inbound", () => {
  it("sends the secret, the bypass header and the messageId; a re-delivery is recognised", async () => {
    const lead = await makeColdLead({ email: "jose@shop.test", status: "contacted", lastEmailedAt: new Date() });
    const { fetchImpl, requests } = appFetch();
    const { env, sent } = makeEnv({ FORWARD_TO: "owner@wright-ai-solutions.test" });

    const { message, forwarded } = emailMessage(REPLY);
    expect(await handleEmail(message, env, fetchImpl)).toMatchObject({ outcome: "delivered", status: 200 });
    expect(requests[0]).toMatchObject({
      url: INBOUND_URL,
      headers: { authorization: "Bearer test-inbound-secret", "x-vercel-protection-bypass": "bypass-123" },
      body: { messageId: "<reply-1@mail.shop.test>" },
    });
    expect(forwarded).toEqual(["owner@wright-ai-solutions.test"]);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("responded");

    // Cloudflare delivers the same message again: recorded once.
    const again = emailMessage(REPLY);
    const second = await handleEmail(again.message, env, fetchImpl);
    expect(second.outcome).toBe("delivered");
    expect(JSON.parse(second.detail)).toMatchObject({ duplicate: true });
    expect(await prisma.inboundReply.count()).toBe(1);
    expect(sent).toHaveLength(0);
  });

  it("forwards headers, so an autoresponder is recognised by Auto-Submitted", async () => {
    const lead = await makeColdLead({ email: "ooo@shop.test", status: "contacted", lastEmailedAt: new Date() });
    const { fetchImpl } = appFetch();
    const bytes = raw([
      "From: ooo@shop.test",
      "Subject: Re: hello",
      "Auto-Submitted: auto-replied",
      "Message-ID: <ooo-1@shop.test>",
      "",
      "Thanks!",
    ]);
    await handleEmail(emailMessage(bytes).message, makeEnv().env, fetchImpl);
    expect(await prisma.inboundReply.findFirstOrThrow()).toMatchObject({ kind: "auto_reply" });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("contacted");
  });

  it("queues the reply when the app answers 503, and the queued resend records it once the database is back", async () => {
    const lead = await makeColdLead({ email: "jose@shop.test", status: "contacted", lastEmailedAt: new Date() });
    const { fetchImpl } = appFetch();
    const { env, sent } = makeEnv();
    const outage = vi
      .spyOn(getPipeline("dataleadsell"), "findLeadsByEmail")
      .mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:5432"));

    const first = await handleEmail(emailMessage(REPLY).message, env, fetchImpl, () => 1_000);
    expect(first).toMatchObject({ outcome: "retry", status: 503 });
    expect(sent).toEqual([
      {
        body: { payload: expect.objectContaining({ messageId: "<reply-1@mail.shop.test>" }), firstAttemptAt: 1_000 },
        options: { delaySeconds: 60 },
      },
    ]);

    // Still down on the first queued attempt: backs off.
    const stillDown = queueMessage(sent[0]!.body, 1);
    await handleQueue([stillDown.message], env, fetchImpl, () => 1_000 + 60_000);
    expect(stillDown.calls).toEqual({ acked: false, retried: { delaySeconds: 120 } });

    outage.mockRestore();
    const recovered = queueMessage(sent[0]!.body, 2);
    await handleQueue([recovered.message], env, fetchImpl, () => 1_000 + 180_000);
    expect(recovered.calls.acked).toBe(true);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("responded");
    expect(await prisma.inboundReply.count()).toBe(1);
  });

  it("never resends a 400 or a 401", async () => {
    const { fetchImpl } = appFetch();
    const bad = makeEnv();
    const badBody = await deliver({ from: "", subject: null, text: "", messageId: null, headers: {} }, bad.env, fetchImpl);
    expect(badBody).toMatchObject({ outcome: "rejected", status: 400 });

    const wrongSecret = makeEnv({ EMAIL_INBOUND_SECRET: "wrong" });
    const result = await handleEmail(emailMessage(REPLY).message, wrongSecret.env, fetchImpl);
    expect(result).toMatchObject({ outcome: "rejected", status: 401 });
    expect(wrongSecret.sent).toHaveLength(0);

    const queued = queueMessage({ payload: buildPayload(REPLY, "x@y.test"), firstAttemptAt: 0 });
    await handleQueue([queued.message], wrongSecret.env, fetchImpl, () => 1);
    expect(queued.calls).toEqual({ acked: true, retried: null });
  });

  it("resends when there is no response at all, and gives up with an alert after 72 hours", async () => {
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const { env, sent } = makeEnv();
    expect(await handleEmail(emailMessage(REPLY).message, env, down, () => 0)).toMatchObject({ outcome: "retry", status: null });
    expect(sent).toHaveLength(1);

    const alert = vi.spyOn(console, "error").mockImplementation(() => {});
    const late = queueMessage(sent[0]!.body, 80);
    await handleQueue([late.message], env, down, () => RETRY_WINDOW_MS);
    expect(late.calls.acked).toBe(true);
    expect(alert).toHaveBeenCalledWith(expect.stringMatching(/^ALERT: reply not recorded after 72 hours/));
  });

  it("backs off from 1 minute, doubling, capped at 1 hour", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 50].map(retryDelaySeconds)).toEqual([60, 120, 240, 480, 960, 1920, 3600, 3600, 3600]);
  });
});
