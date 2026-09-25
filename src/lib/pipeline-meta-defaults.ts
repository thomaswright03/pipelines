// Fallback card copy shown for a pipeline until someone edits it (which
// writes a real row into PipelineMeta). Keyed by pipeline id.
export type PipelineMetaFields = {
  name: string;
  company: string;
  productDescription: string;
  pipelineDescription: string;
};

const PIPELINE_META_DEFAULTS: Record<string, PipelineMetaFields> = {
  "ai-lead-responder": {
    name: "AI Lead Responder",
    company: "Mountain High Disposal / Eastern Waste & Recycling / Garden State Bin Cleaning",
    productDescription: "Dumpster rental and waste removal services for residential and commercial customers.",
    pipelineDescription:
      "Claude drafts and sends SMS replies to inbound leads in GoHighLevel, with deterministic safety checks (opt-outs, quiet hours) enforced in code before any AI-drafted message goes out.",
  },
  dataleadsell: {
    name: "dataleadsell.com",
    company: "Wright AI Solutions, LLC",
    productDescription:
      "Probate Property Leads subscriptions sold by county to real estate agents — verified leads corroborated against the deceased's obituary, plus optional mailed letters to the heirs.",
    pipelineDescription:
      "Finds real estate agents in Maricopa, Salt Lake, and Utah counties, finds their email, pitches them a subscription by email, tracks replies and bounces, and routes non-responders to a phone cold-call deck.",
  },
  "cold-outreach": {
    name: "Cold Outreach",
    company: "Wright AI Solutions, LLC",
    productDescription:
      "Custom websites, AI, automations, and software built around whatever a business actually needs — no fixed package.",
    pipelineDescription:
      "Scrapes local businesses nationwide, finds contact info, sends cold email outreach, tracks replies/bounces, and routes non-responders into a phone cold-call queue.",
  },
};

export function getPipelineMetaDefaults(id: string): PipelineMetaFields {
  return (
    PIPELINE_META_DEFAULTS[id] ?? {
      name: id,
      company: "",
      productDescription: "",
      pipelineDescription: "",
    }
  );
}
