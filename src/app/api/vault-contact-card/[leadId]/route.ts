import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

// vCard 3.0 text-value escaping (RFC 6350 §3.4).
function escapeVCardValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params;
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { name: true, phone: true } });
  if (!lead) {
    return new Response("Not found", { status: 404 });
  }
  if (!lead.phone) {
    return new Response("This lead has no phone number on file", { status: 400 });
  }

  const name = escapeVCardValue(lead.name);
  const phone = escapeVCardValue(lead.phone);
  const vcard = ["BEGIN:VCARD", "VERSION:3.0", `N:${name};;;;`, `FN:${name}`, `TEL;TYPE=CELL:${phone}`, "END:VCARD", ""].join(
    "\r\n",
  );

  // "inline" (not "attachment") is what makes a phone browser open its
  // native Add Contact sheet directly instead of just saving a file.
  const fileName = lead.name.replace(/[^\w\s-]/g, "").trim() || "contact";
  return new Response(vcard, {
    headers: {
      "Content-Type": "text/vcard; charset=utf-8",
      "Content-Disposition": `inline; filename="${fileName}.vcf"`,
    },
  });
}
