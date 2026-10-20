// Registry of every marketing pipeline this dashboard knows about.
//
// "internal" pipelines live inside this app (see src/app/dataleadsell,
// src/app/vault-pipeline, src/app/garbage-ai, src/app/room-designer). "hosted" pipelines are separate codebases
// already deployed as their own live, always-on Vercel project — nothing
// to start/stop, Pipelines just links out to it.
//
// (There used to be an "external" kind that spawned a local dev-server
// process for a pipeline living on this Mac. Removed — the whole point of
// this registry is that nothing here should depend on a particular
// machine being on, and a locally-spawned process is exactly that.)
//
// This registry only holds technical wiring (id, hrefs/urls) — the
// human-facing name/company/descriptions shown on each dashboard card are
// editable and live in the PipelineMeta table instead (see
// lib/pipeline-meta-defaults.ts for the fallback shown before anyone edits
// a card).
export type InternalPipeline = {
  id: string;
  kind: "internal";
  href: string;
};

export type HostedPipeline = {
  id: string;
  kind: "hosted";
  dashboardUrl: string;
};

export type Pipeline = InternalPipeline | HostedPipeline;

export const PIPELINES: Pipeline[] = [
  {
    id: "ai-lead-responder",
    kind: "hosted",
    // GoHighLevel calls this project's /api/webhook directly on every
    // inbound message — always-on, no local machine involved at all. This
    // links to its Vercel project dashboard (deployment status, logs),
    // not a page meant for humans to browse.
    dashboardUrl: "https://vercel.com/kaizen-marketing/lead-responder",
  },
  {
    id: "dataleadsell",
    kind: "internal",
    href: "/dataleadsell",
  },
  {
    id: "cold-outreach",
    kind: "internal",
    href: "/vault-pipeline",
  },
  {
    id: "garbage-ai",
    kind: "internal",
    href: "/garbage-ai",
  },
  {
    id: "room-designer",
    kind: "internal",
    href: "/room-designer",
  },
];
