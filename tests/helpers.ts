import { vi } from "vitest";
import { prisma } from "@/lib/db";
import { setMailTransportForTesting, type MailMessage } from "@/lib/send-email";

export async function resetDatabase(): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

type Failure = Error & { code?: string; syscall?: string; responseCode?: number; command?: string; response?: string };

/**
 * Installs a capturing mail transport. `fail(err)` makes following sends
 * throw `err` (optionally only `times` times); `delayMs` slows each send so
 * concurrency tests can overlap.
 */
export function captureMail(options: { delayMs?: number } = {}) {
  const messages: MailMessage[] = [];
  let failure: { err: Failure; remaining: number } | null = null;
  const refusals = new Map<string, Failure>();
  let counter = 0;
  setMailTransportForTesting({
    async sendMail(message) {
      if (options.delayMs) await new Promise((r) => setTimeout(r, options.delayMs));
      if (failure && failure.remaining > 0) {
        failure.remaining--;
        throw failure.err;
      }
      const refusal = refusals.get(message.to.toLowerCase());
      if (refusal) throw refusal;
      messages.push(message);
      counter++;
      return { messageId: `<test-${counter}-${Date.now()}@pipelines.test>` };
    },
    // "Test connection": fails the same way sends do while `fail` is set.
    async verify() {
      if (failure && failure.remaining > 0) throw failure.err;
    },
  });
  return {
    messages,
    to: () => messages.map((m) => m.to),
    fail(err: Failure, times = Number.POSITIVE_INFINITY) {
      failure = { err, remaining: times };
    },
    /** Every send to `email` throws `err` (default: a permanent "550 user unknown" at RCPT TO). */
    refuse(email: string, err: Failure = recipientRefusal(email)) {
      refusals.set(email.toLowerCase(), err);
    },
    /** Stops refusing `email`. */
    accept(email: string) {
      refusals.delete(email.toLowerCase());
    },
    restore() {
      setMailTransportForTesting(null);
    },
  };
}

/** What nodemailer throws when the server refuses the recipient at RCPT TO. */
export function recipientRefusal(email: string, responseCode = 550): Failure {
  const response =
    responseCode >= 500 ? `${responseCode} 5.1.1 <${email}>: User unknown` : `${responseCode} 4.2.2 <${email}>: Mailbox full, try later`;
  return smtpError(`Can't send mail - all recipients were rejected: ${response}`, {
    code: "EENVELOPE",
    command: "RCPT TO",
    responseCode,
    response,
  });
}

export function smtpError(message: string, fields: Partial<Failure>): Failure {
  return Object.assign(new Error(message), fields);
}

type Route = { status?: number; body: string; contentType?: string };

/**
 * Replaces fetch with fixture responses keyed by URL (exact match, or a
 * function). Unknown URLs behave like a domain that doesn't exist.
 */
export function stubFetch(routes: Record<string, Route | ((url: string) => Route | null)>) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = input instanceof URL ? input.toString() : typeof input === "string" ? input : (input as Request).url;
    calls.push(url);
    let route: Route | null = null;
    for (const [key, value] of Object.entries(routes)) {
      if (typeof value === "function") {
        if (url.startsWith(key)) route = value(url);
      } else if (url === key || url === `${key}/`) {
        route = value;
      }
      if (route) break;
    }
    // Like a domain that doesn't resolve — a definite "no such site".
    if (!route) throw Object.assign(new TypeError(`fetch failed (no fixture for ${url})`), { cause: { code: "ENOTFOUND" } });
    return new Response(route.body, {
      status: route.status ?? 200,
      headers: { "content-type": route.contentType ?? "text/html; charset=utf-8" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

export function yelpResponse(businesses: { name: string; phone?: string; address?: string }[]): Route {
  return {
    contentType: "application/json",
    body: JSON.stringify({
      businesses: businesses.map((b) => ({
        name: b.name,
        phone: b.phone ?? "",
        location: { display_address: [b.address ?? "1 Main St", "Phoenix, AZ 85001"] },
      })),
    }),
  };
}

export const YELP_PREFIX = "https://api.yelp.com/v3/businesses/search";

export function page(html: string): Route {
  return { body: `<html><body>${html}</body></html>` };
}

let seq = 0;
export async function makeColdLead(data: Partial<Parameters<typeof prisma.lead.create>[0]["data"]> = {}) {
  seq++;
  return prisma.lead.create({
    data: { name: `Business ${seq}`, email: `owner${seq}@business${seq}.test`, status: "new", ...data },
  });
}

export async function makeHaulerLead(data: Partial<Parameters<typeof prisma.haulerLead.create>[0]["data"]> = {}) {
  seq++;
  return prisma.haulerLead.create({
    data: { name: `Hauler ${seq}`, company: `Hauler ${seq}`, email: `office${seq}@hauler${seq}.test`, status: "new", ...data },
  });
}

export async function makeRemodelerLead(data: Partial<Parameters<typeof prisma.remodelerLead.create>[0]["data"]> = {}) {
  seq++;
  return prisma.remodelerLead.create({
    data: { name: `Remodeler ${seq}`, company: `Remodeler ${seq}`, email: `info${seq}@remodeler${seq}.test`, status: "new", ...data },
  });
}

export async function makeAgentLead(data: Partial<Parameters<typeof prisma.agentLead.create>[0]["data"]> = {}) {
  seq++;
  return prisma.agentLead.create({
    data: {
      name: `Agent ${seq}`,
      email: `agent${seq}@realty${seq}.test`,
      county: "Maricopa",
      state: "AZ",
      status: "new",
      ...data,
    },
  });
}
