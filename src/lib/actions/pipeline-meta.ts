"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/log";

const metaSchema = z.object({
  name: z.string().trim().min(1, "Pipeline name is required").max(80, "Pipeline name can be at most 80 characters"),
  company: z.string().trim().max(160, "Company can be at most 160 characters"),
  productDescription: z.string().trim().max(600, "Product description can be at most 600 characters"),
  pipelineDescription: z.string().trim().max(600, "Pipeline description can be at most 600 characters"),
});

export async function updatePipelineMetaAction(pipelineId: string, formData: FormData): Promise<{ error?: string }> {
  const parsed = metaSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    company: String(formData.get("company") ?? ""),
    productDescription: String(formData.get("productDescription") ?? ""),
    pipelineDescription: String(formData.get("pipelineDescription") ?? ""),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  try {
    await prisma.pipelineMeta.upsert({
      where: { id: pipelineId },
      create: { id: pipelineId, ...parsed.data },
      update: parsed.data,
    });
  } catch (err) {
    logError("action.updatePipelineMeta", err, { pipelineId });
    return { error: "Couldn't save the card — nothing changed. Try again in a moment." };
  }

  revalidatePath("/");
  return {};
}
