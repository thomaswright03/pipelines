// Per-pipeline data access. Each pipeline keeps its own tables (AgentLead +
// EmailSendLog for dataleadsell, Lead + LeadEmailSendLog for Cold
// Outreach); everything that decides *who* gets emailed lives once in the
// shared modules next to this file and reaches the tables only through the
// small adapter below.
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { buildAgentOutreachEmail } from "@/lib/dataleadsell-email-template";
import { buildOutreachEmail } from "@/lib/vault-email-template";
import { DATALEADSELL_SENDER_EMAIL } from "@/lib/dataleadsell-config";
import { VAULT_PIPELINE_SENDER_EMAIL } from "@/lib/vault-config";
import { PIPELINE_BASE_PATH, PIPELINE_LABEL, type PipelineId } from "@/lib/outreach/pipeline-id";

export type Db = PrismaClient | Prisma.TransactionClient;

/** The fields every send/discovery rule needs, in both pipelines. */
export type OutreachLead = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: string;
  website: string | null;
  city: string | null;
  state: string | null;
  sendBlockedReason: string | null;
  lastEmailedAt: Date | null;
  repliedAt: Date | null;
  notes: string | null;
  company: string | null; // Cold Outreach only
  brokerage: string | null; // dataleadsell only
  county: string | null; // dataleadsell only
};

/** Columns both lead tables share, for updates made by shared rules. */
export type LeadUpdate = {
  status?: string;
  email?: string | null;
  website?: string | null;
  emailCheckedAt?: Date | null;
  sendBlockedReason?: string | null;
  lastEmailedAt?: Date | null;
  repliedAt?: Date | null;
  ourReplyAt?: Date | null;
  callOutcome?: string | null;
  notes?: string | null;
  starred?: boolean;
  replyNeedsReview?: boolean;
};

export type NewLeadData = {
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  website: string | null;
  city: string | null;
  state: string | null;
  county?: string | null;
  brokerage?: string | null;
  company?: string | null;
  source: string;
  notes?: string | null;
  emailCheckedAt?: Date | null;
  status?: string;
};

export type PipelineAdapter = {
  id: PipelineId;
  label: string;
  basePath: string;
  senderEmail: string;
  buildEmail(lead: OutreachLead): { subject: string; body: string };
  findLead(db: Db, id: string): Promise<OutreachLead | null>;
  findLeadsByEmail(db: Db, email: string, excludeId?: string): Promise<OutreachLead[]>;
  findNamesTaken(db: Db, names: string[]): Promise<Set<string>>;
  createLead(db: Db, data: NewLeadData): Promise<OutreachLead>;
  update(db: Db, id: string, data: LeadUpdate): Promise<void>;
  /**
   * Applies `data` only if the lead is still in one of `statuses` (so an
   * automated move can't overwrite a change made a moment earlier).
   * Returns whether it applied.
   */
  updateIfStatus(db: Db, id: string, statuses: readonly string[], data: LeadUpdate): Promise<boolean>;
  /** Moves a lead new → contacted iff it is still new with this address. */
  claimForSend(db: Db, leadId: string, email: string, at: Date): Promise<boolean>;
  /** Undoes claimForSend after a send that definitely didn't go out. */
  releaseClaim(db: Db, leadId: string, claimedAt: Date, previous: { lastEmailedAt: Date | null; repliedAt: Date | null }): Promise<void>;
  recordSend(db: Db, leadId: string, email: string, providerMessageId: string, sentAt: Date): Promise<void>;
  markLatestSendBounced(db: Db, leadId: string, at: Date): Promise<boolean>;
  hasBeenEmailed(db: Db, leadId: string): Promise<boolean>;
  /** Leads the bulk send may pitch: new, with an address, not flagged. */
  listSendable(db: Db, limit: number): Promise<OutreachLead[]>;
  countSendable(db: Db): Promise<number>;
  listStaleContacted(db: Db, cutoff: Date): Promise<OutreachLead[]>;
  listNeedingEmailLookup(db: Db, limit: number): Promise<OutreachLead[]>;
  countNeedingEmailLookup(db: Db): Promise<number>;
  clearSendBlockedByPrefix(db: Db, email: string, prefix: string): Promise<void>;
};

const SENDABLE = { status: "new", email: { not: null }, sendBlockedReason: null } as const;
const NEEDS_LOOKUP = { email: null, emailCheckedAt: null } as const;

function agentToOutreach(lead: {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: string;
  website: string | null;
  city: string | null;
  state: string | null;
  sendBlockedReason: string | null;
  lastEmailedAt: Date | null;
  repliedAt: Date | null;
  notes: string | null;
  brokerage: string | null;
  county: string | null;
}): OutreachLead {
  return { ...pickCommon(lead), company: null, brokerage: lead.brokerage, county: lead.county };
}

function coldToOutreach(lead: {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: string;
  website: string | null;
  city: string | null;
  state: string | null;
  sendBlockedReason: string | null;
  lastEmailedAt: Date | null;
  repliedAt: Date | null;
  notes: string | null;
  company: string | null;
}): OutreachLead {
  return { ...pickCommon(lead), company: lead.company, brokerage: null, county: null };
}

function pickCommon(lead: Omit<OutreachLead, "company" | "brokerage" | "county">) {
  return {
    id: lead.id,
    name: lead.name,
    email: lead.email,
    phone: lead.phone,
    status: lead.status,
    website: lead.website,
    city: lead.city,
    state: lead.state,
    sendBlockedReason: lead.sendBlockedReason,
    lastEmailedAt: lead.lastEmailedAt,
    repliedAt: lead.repliedAt,
    notes: lead.notes,
  };
}

const dataleadsell: PipelineAdapter = {
  id: "dataleadsell",
  label: PIPELINE_LABEL.dataleadsell,
  basePath: PIPELINE_BASE_PATH.dataleadsell,
  senderEmail: DATALEADSELL_SENDER_EMAIL,
  buildEmail: (lead) => buildAgentOutreachEmail(lead.name, lead.county),
  async findLead(db, id) {
    const lead = await db.agentLead.findUnique({ where: { id } });
    return lead && agentToOutreach(lead);
  },
  async findLeadsByEmail(db, email, excludeId) {
    const leads = await db.agentLead.findMany({
      where: { email: email.toLowerCase(), ...(excludeId ? { id: { not: excludeId } } : {}) },
      orderBy: { createdAt: "asc" },
    });
    return leads.map(agentToOutreach);
  },
  async findNamesTaken(db, names) {
    if (names.length === 0) return new Set();
    const rows = await db.agentLead.findMany({
      where: { OR: names.map((name) => ({ name: { equals: name.trim(), mode: "insensitive" as const } })) },
      select: { name: true },
    });
    return new Set(rows.map((r) => r.name.trim().toLowerCase()));
  },
  async createLead(db, data) {
    const lead = await db.agentLead.create({
      data: {
        name: data.name,
        email: data.email,
        phone: data.phone,
        address: data.address,
        website: data.website,
        city: data.city,
        state: data.state,
        county: data.county ?? null,
        brokerage: data.brokerage ?? null,
        source: data.source,
        notes: data.notes ?? null,
        emailCheckedAt: data.emailCheckedAt ?? null,
        status: data.status ?? "new",
      },
    });
    return agentToOutreach(lead);
  },
  async update(db, id, data) {
    await db.agentLead.update({ where: { id }, data });
  },
  async updateIfStatus(db, id, statuses, data) {
    const { count } = await db.agentLead.updateMany({ where: { id, status: { in: [...statuses] } }, data });
    return count === 1;
  },
  async claimForSend(db, leadId, email, at) {
    const { count } = await db.agentLead.updateMany({
      where: { id: leadId, status: "new", email, sendBlockedReason: null },
      data: { status: "contacted", lastEmailedAt: at, repliedAt: null },
    });
    return count === 1;
  },
  async releaseClaim(db, leadId, claimedAt, previous) {
    await db.agentLead.updateMany({
      where: { id: leadId, status: "contacted", lastEmailedAt: claimedAt },
      data: { status: "new", lastEmailedAt: previous.lastEmailedAt, repliedAt: previous.repliedAt },
    });
  },
  async recordSend(db, leadId, email, providerMessageId, sentAt) {
    await db.emailSendLog.create({ data: { leadId, email, providerMessageId, sentAt } });
  },
  async markLatestSendBounced(db, leadId, at) {
    const log = await db.emailSendLog.findFirst({ where: { leadId, bounced: false }, orderBy: { sentAt: "desc" } });
    if (!log) return false;
    await db.emailSendLog.update({ where: { id: log.id }, data: { bounced: true, bouncedAt: at } });
    return true;
  },
  async hasBeenEmailed(db, leadId) {
    return (await db.emailSendLog.count({ where: { leadId } })) > 0;
  },
  async listSendable(db, limit) {
    const leads = await db.agentLead.findMany({ where: SENDABLE, orderBy: { createdAt: "asc" }, take: limit });
    return leads.map(agentToOutreach);
  },
  countSendable: (db) => db.agentLead.count({ where: SENDABLE }),
  async listStaleContacted(db, cutoff) {
    const leads = await db.agentLead.findMany({ where: { status: "contacted", lastEmailedAt: { lte: cutoff } } });
    return leads.map(agentToOutreach);
  },
  async listNeedingEmailLookup(db, limit) {
    const leads = await db.agentLead.findMany({ where: NEEDS_LOOKUP, orderBy: { createdAt: "asc" }, take: limit });
    return leads.map(agentToOutreach);
  },
  countNeedingEmailLookup: (db) => db.agentLead.count({ where: NEEDS_LOOKUP }),
  async clearSendBlockedByPrefix(db, email, prefix) {
    await db.agentLead.updateMany({
      where: { email: email.toLowerCase(), sendBlockedReason: { startsWith: prefix } },
      data: { sendBlockedReason: null },
    });
  },
};

const coldOutreach: PipelineAdapter = {
  id: "cold-outreach",
  label: PIPELINE_LABEL["cold-outreach"],
  basePath: PIPELINE_BASE_PATH["cold-outreach"],
  senderEmail: VAULT_PIPELINE_SENDER_EMAIL,
  buildEmail: (lead) => buildOutreachEmail(lead.company || lead.name),
  async findLead(db, id) {
    const lead = await db.lead.findUnique({ where: { id } });
    return lead && coldToOutreach(lead);
  },
  async findLeadsByEmail(db, email, excludeId) {
    const leads = await db.lead.findMany({
      where: { email: email.toLowerCase(), ...(excludeId ? { id: { not: excludeId } } : {}) },
      orderBy: { createdAt: "asc" },
    });
    return leads.map(coldToOutreach);
  },
  async findNamesTaken(db, names) {
    if (names.length === 0) return new Set();
    const rows = await db.lead.findMany({
      where: { OR: names.map((name) => ({ name: { equals: name.trim(), mode: "insensitive" as const } })) },
      select: { name: true },
    });
    return new Set(rows.map((r) => r.name.trim().toLowerCase()));
  },
  async createLead(db, data) {
    const lead = await db.lead.create({
      data: {
        name: data.name,
        company: data.company ?? null,
        email: data.email,
        phone: data.phone,
        address: data.address,
        website: data.website,
        city: data.city,
        state: data.state,
        source: data.source,
        notes: data.notes ?? null,
        emailCheckedAt: data.emailCheckedAt ?? null,
        status: data.status ?? "new",
      },
    });
    return coldToOutreach(lead);
  },
  async update(db, id, data) {
    await db.lead.update({ where: { id }, data });
  },
  async updateIfStatus(db, id, statuses, data) {
    const { count } = await db.lead.updateMany({ where: { id, status: { in: [...statuses] } }, data });
    return count === 1;
  },
  async claimForSend(db, leadId, email, at) {
    const { count } = await db.lead.updateMany({
      where: { id: leadId, status: "new", email, sendBlockedReason: null },
      data: { status: "contacted", lastEmailedAt: at, repliedAt: null },
    });
    return count === 1;
  },
  async releaseClaim(db, leadId, claimedAt, previous) {
    await db.lead.updateMany({
      where: { id: leadId, status: "contacted", lastEmailedAt: claimedAt },
      data: { status: "new", lastEmailedAt: previous.lastEmailedAt, repliedAt: previous.repliedAt },
    });
  },
  async recordSend(db, leadId, email, providerMessageId, sentAt) {
    await db.leadEmailSendLog.create({ data: { leadId, email, providerMessageId, sentAt } });
  },
  async markLatestSendBounced(db, leadId, at) {
    const log = await db.leadEmailSendLog.findFirst({ where: { leadId, bounced: false }, orderBy: { sentAt: "desc" } });
    if (!log) return false;
    await db.leadEmailSendLog.update({ where: { id: log.id }, data: { bounced: true, bouncedAt: at } });
    return true;
  },
  async hasBeenEmailed(db, leadId) {
    return (await db.leadEmailSendLog.count({ where: { leadId } })) > 0;
  },
  async listSendable(db, limit) {
    const leads = await db.lead.findMany({ where: SENDABLE, orderBy: { createdAt: "asc" }, take: limit });
    return leads.map(coldToOutreach);
  },
  countSendable: (db) => db.lead.count({ where: SENDABLE }),
  async listStaleContacted(db, cutoff) {
    const leads = await db.lead.findMany({ where: { status: "contacted", lastEmailedAt: { lte: cutoff } } });
    return leads.map(coldToOutreach);
  },
  async listNeedingEmailLookup(db, limit) {
    const leads = await db.lead.findMany({ where: NEEDS_LOOKUP, orderBy: { createdAt: "asc" }, take: limit });
    return leads.map(coldToOutreach);
  },
  countNeedingEmailLookup: (db) => db.lead.count({ where: NEEDS_LOOKUP }),
  async clearSendBlockedByPrefix(db, email, prefix) {
    await db.lead.updateMany({
      where: { email: email.toLowerCase(), sendBlockedReason: { startsWith: prefix } },
      data: { sendBlockedReason: null },
    });
  },
};

const ADAPTERS: Record<PipelineId, PipelineAdapter> = { dataleadsell, "cold-outreach": coldOutreach };

export function getPipeline(id: PipelineId): PipelineAdapter {
  return ADAPTERS[id];
}

export const ALL_PIPELINES: PipelineAdapter[] = [dataleadsell, coldOutreach];
