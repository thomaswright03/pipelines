import { prisma } from "@/lib/db";
import { getPipelineMetaDefaults, type PipelineMetaFields } from "@/lib/pipeline-meta-defaults";

/** A dashboard card's editable copy, or its defaults if never edited. */
export async function getPipelineMeta(pipelineId: string): Promise<PipelineMetaFields> {
  const row = await prisma.pipelineMeta.findUnique({ where: { id: pipelineId } });
  if (row) {
    return {
      name: row.name,
      company: row.company,
      productDescription: row.productDescription,
      pipelineDescription: row.pipelineDescription,
    };
  }
  return getPipelineMetaDefaults(pipelineId);
}
