// Pipeline identifiers shared by server and client code. Kept free of any
// server-only imports so client components can use it too.
export const PIPELINE_IDS = ["dataleadsell", "cold-outreach", "garbage-ai"] as const;
export type PipelineId = (typeof PIPELINE_IDS)[number];

export const PIPELINE_LABEL: Record<PipelineId, string> = {
  dataleadsell: "dataleadsell.com",
  "cold-outreach": "Cold Outreach",
  "garbage-ai": "Garbage AI",
};

/** What each pipeline calls its records on screen ("3 agents ready to email"). */
export const LEAD_NOUN: Record<PipelineId, { one: string; many: string }> = {
  dataleadsell: { one: "agent", many: "agents" },
  "cold-outreach": { one: "lead", many: "leads" },
  "garbage-ai": { one: "hauler", many: "haulers" },
};

export const PIPELINE_BASE_PATH: Record<PipelineId, string> = {
  dataleadsell: "/dataleadsell",
  "cold-outreach": "/vault-pipeline",
  "garbage-ai": "/garbage-ai",
};

/** Validates an untrusted pipeline id (server actions receive plain strings). */
export function parsePipelineId(value: unknown): PipelineId {
  if (typeof value === "string" && (PIPELINE_IDS as readonly string[]).includes(value)) {
    return value as PipelineId;
  }
  throw new Error(`Unknown pipeline "${String(value)}"`);
}
