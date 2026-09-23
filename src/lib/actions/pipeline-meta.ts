"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getPipelineMetaDefaults } from "@/lib/pipeline-meta-defaults";

const metaSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  company: z.string().trim(),
  productDescription: z.string().trim(),
  pipelineDescription: z.string().trim(),
});

export async function updatePipelineMetaAction(
  pipelineId: string,
  formData: FormData,
): Promise<{ error?: string }> {
  const parsed = metaSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    company: String(formData.get("company") ?? ""),
    productDescription: String(formData.get("productDescription") ?? ""),
    pipelineDescription: String(formData.get("pipelineDescription") ?? ""),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  await prisma.pipelineMeta.upsert({
    where: { id: pipelineId },
    create: { id: pipelineId, ...parsed.data },
    update: parsed.data,
  });

  revalidatePath("/");
  return {};
}

export async function getPipelineMeta(pipelineId: string) {
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
