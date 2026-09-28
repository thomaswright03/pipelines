import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { buildVCard, vcardFileName } from "@/lib/vcard";
import { parsePipelineId } from "@/lib/outreach/pipeline-id";
import { getPipeline } from "@/lib/outreach/pipelines";

// "Add to Contacts" from either pipeline's cold-call deck. Served inline so
// a phone browser opens its native Add Contact sheet instead of saving a file.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ pipeline: string; leadId: string }> }) {
  const { pipeline: rawPipeline, leadId } = await params;
  let pipelineId;
  try {
    pipelineId = parsePipelineId(rawPipeline);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const lead = await getPipeline(pipelineId).findLead(prisma, leadId);
  if (!lead) return new Response("Not found", { status: 404 });
  if (!lead.phone) return new Response("This lead has no phone number on file", { status: 400 });

  return new Response(buildVCard(lead.name, lead.phone), {
    headers: {
      "Content-Type": "text/vcard; charset=utf-8",
      "Content-Disposition": `inline; filename="${vcardFileName(lead.name)}.vcf"`,
    },
  });
}
