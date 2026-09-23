import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { textRequestsOptOut, suppressEmail } from "@/lib/email-suppression";

// Receives a parsed inbound email from the Cloudflare Email Worker that
// catches replies sent to thomas@wright-ai-solutions.com (see
// cloudflare-email-worker/ at the repo root for that Worker's source).
// Cloudflare Email Routing has no built-in webhook of its own — the Worker
// is what turns "someone replied" into an HTTP call here.
//
// Both dataleadsell (AgentLead) and Cold Outreach (Lead) currently send
// from the same address, so a reply's "From" is matched against both
// tables — whichever one has a lead with that email gets marked replied,
// the same way the manual "Mark replied" buttons do.
const EXPECTED_AUTH = `Bearer ${process.env.EMAIL_INBOUND_SECRET}`;

type InboundEmail = { from: string; subject: string; text: string };

function extractEmailAddress(from: string): string {
  // Handles both "Jane Smith <jane@example.com>" and a bare "jane@example.com".
  const match = from.match(/<([^>]+)>/);
  return (match ? match[1] : from).trim().toLowerCase();
}

export async function POST(request: NextRequest) {
  if (!process.env.EMAIL_INBOUND_SECRET || request.headers.get("authorization") !== EXPECTED_AUTH) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = (await request.json()) as InboundEmail;
  const fromEmail = extractEmailAddress(body.from);
  if (!fromEmail) {
    return new Response("No from address", { status: 400 });
  }

  const notesStamp = `[Reply received ${new Date().toLocaleString()}]: ${body.subject}\n${body.text}`.trim();
  const matched: string[] = [];

  // CAN-SPAM requires honoring an opt-out — both email templates now say
  // "reply STOP", so this is what actually makes that true: the sender
  // goes on a permanent suppression list checked before every future send
  // (see email-suppression.ts), on top of the normal reply handling below.
  const optedOut = textRequestsOptOut(body.text);
  if (optedOut) {
    await suppressEmail(fromEmail, "Replied STOP/unsubscribe");
  }

  const agentLead = await prisma.agentLead.findFirst({ where: { email: fromEmail, status: "contacted" } });
  if (agentLead) {
    await prisma.agentLead.update({
      where: { id: agentLead.id },
      data: {
        repliedAt: new Date(),
        status: optedOut ? "not_interested" : "responded",
        notes: [agentLead.notes, notesStamp].filter(Boolean).join("\n\n"),
      },
    });
    matched.push(`dataleadsell:${agentLead.id}`);
  }

  const lead = await prisma.lead.findFirst({ where: { email: fromEmail, status: "contacted" } });
  if (lead) {
    await prisma.lead.update({
      where: { id: lead.id },
      data: { repliedAt: new Date(), status: optedOut ? "lost" : "responded" },
    });
    await prisma.leadActivity.create({
      data: { leadId: lead.id, type: "email", notes: notesStamp },
    });
    matched.push(`cold-outreach:${lead.id}`);
  }

  return Response.json({ matched, optedOut });
}
