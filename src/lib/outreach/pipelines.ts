// Per-pipeline data access. Each pipeline keeps its own tables (AgentLead +
// EmailSendLog for dataleadsell, Lead + LeadEmailSendLog for Cold
// Outreach); everything that decides *who* gets emailed lives once in the
// shared modules next to this file and reaches the tables only through the
// adapter below.
//
// Both adapters are built by one factory: the tables have the same shape
// for every column the shared rules touch, so the only per-pipeline
// differences are data — which tables, which pitch, which sender, and the
// one pipeline-specific column (company vs brokerage/county).
import type { AgentLead, Lead, Prisma, PrismaClient } from "@/generated/prisma/client";
import { buildAgentOutreachEmail } from "@/lib/dataleadsell-email-template";
import { buildOutreachEmail } from "@/lib/vault-email-template";
import { DATALEADSELL_SENDER_EMAIL } from "@/lib/dataleadsell-config";
import { VAULT_PIPELINE_SENDER_EMAIL } from "@/lib/vault-config";
import { PIPELINE_BASE_PATH, PIPELINE_LABEL, type PipelineId } from "@/lib/outreach/pipeline-id";

export type Db = PrismaClient | Prisma.TransactionClient;

export const ACTIVITY_TYPES = ["note", "call", "email", "meeting"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

/** The fields every send/discovery rule needs, in both pipelines. */
export type OutreachLead = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  status: string;
  website: string | null;
  city: string | null;
  state: string | null;
  sendBlockedReason: string | null;
  /** Temporary refusals of this address by the recipient's mail server so far. */
  sendRefusalCount: number;
  lastEmailedAt: Date | null;
  repliedAt: Date | null;
  notes: string | null;
  /** Why the address is believed to be the lead's (see AgentLead.emailEvidence). */
  emailEvidence: string | null;
  company: string | null; // Cold Outreach only
  brokerage: string | null; // dataleadsell only
  county: string | null; // dataleadsell only
};

/** Columns both lead tables share, for updates made by shared rules. */
export type LeadUpdate = {
  status?: string;
  email?: string | null;
  emailEvidence?: string | null;
  emailRulesVersion?: string | null;
  website?: string | null;
  emailCheckedAt?: Date | null;
  emailLookupFailedAt?: Date | null;
  sendBlockedReason?: string | null;
  lastSendFailedAt?: Date | null;
  lastSendFailure?: string | null;
  sendRefusalCount?: number;
  lastEmailedAt?: Date | null;
  repliedAt?: Date | null;
  ourReplyAt?: Date | null;
  callOutcome?: string | null;
  notes?: string | null;
  starred?: boolean;
  replyNeedsReview?: boolean;
  replyReviewReason?: string | null;
};

export type NewLeadData = {
  name: string;
  email: string | null;
  emailEvidence?: string | null;
  emailRulesVersion?: string | null;
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

/** An existing lead with the same name, and what tells two of them apart. */
export type NamedLead = { id: string; name: string; phone: string | null; address: string | null; city: string | null };

export type PipelineAdapter = {
  id: PipelineId;
  label: string;
  basePath: string;
  senderEmail: string;
  buildEmail(lead: Pick<OutreachLead, "name" | "company" | "county">): { subject: string; body: string };
  findLead(db: Db, id: string): Promise<OutreachLead | null>;
  findLeadsByEmail(db: Db, email: string, excludeId?: string): Promise<OutreachLead[]>;
  /** Leads whose name equals one of `names` (case-insensitively), for duplicate checks. */
  findSameNamed(db: Db, names: string[]): Promise<NamedLead[]>;
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
  /** New leads with an address that can't be sent (flagged), for the "why nothing to send" hint. */
  countBlockedNew(db: Db): Promise<number>;
  listStaleContacted(db: Db, cutoff: Date): Promise<OutreachLead[]>;
  /**
   * Leads with no address that were never checked, leaving out any whose
   * site was unreachable at or after `retryBefore` (they're retried later).
   */
  listNeedingEmailLookup(db: Db, limit: number, retryBefore?: Date): Promise<OutreachLead[]>;
  countNeedingEmailLookup(db: Db, retryBefore?: Date): Promise<number>;
  /** Leads matching a name/email search, for attaching an unmatched reply. */
  search(db: Db, query: string, limit: number): Promise<OutreachLead[]>;
  clearSendBlockedByPrefix(db: Db, email: string, prefix: string): Promise<void>;
  /**
   * Edits a lead's details only if its status and address are still what
   * the edit was based on (a send moves New → Contacted, so an address can't
   * be changed under a send in flight). Returns whether it applied.
   */
  updateIfUnchanged(
    db: Db,
    id: string,
    expected: { status: string; email: string | null },
    data: Record<string, unknown>,
  ): Promise<boolean>;
  /**
   * Adds an entry to the lead's history (replies, calls, notes the operator
   * logs) — kept apart from the lead's Notes field, so automatically
   * recorded history never counts against the notes limit.
   */
  addActivity(db: Db, leadId: string, entry: { type: ActivityType; notes: string; date?: Date }): Promise<void>;
  /** Deletes the lead. Its send history rows and ledger entry stay (so the address is never re-pitched). */
  deleteLead(db: Db, id: string): Promise<boolean>;
};

const SENDABLE = { status: "new", email: { not: null }, sendBlockedReason: null } as const satisfies Prisma.LeadWhereInput &
  Prisma.AgentLeadWhereInput;
const BLOCKED_NEW = { status: "new", email: { not: null }, sendBlockedReason: { not: null } } as const satisfies Prisma.LeadWhereInput &
  Prisma.AgentLeadWhereInput;
function needsLookup(retryBefore?: Date): Prisma.LeadWhereInput & Prisma.AgentLeadWhereInput {
  return {
    email: null,
    emailCheckedAt: null,
    ...(retryBefore ? { OR: [{ emailLookupFailedAt: null }, { emailLookupFailedAt: { lt: retryBefore } }] } : {}),
  };
}

// The two lead tables (and the two send-log tables) differ only in their
// pipeline-specific columns, so the factory talks to them through these
// minimal structural views. Prisma's delegate types can't be unified across
// two models (hence the casts where each view is made), but every argument is
// typed as valid for both models at once — see LeadTable below.
type Row = Omit<OutreachLead, "company" | "brokerage" | "county"> & {
  company?: string | null;
  brokerage?: string | null;
  county?: string | null;
};
// Every argument must be valid for BOTH models (the intersection of the two
// Prisma argument types), so a column the shared rules use that one table
// lacks, or has with a different type, is a compile error.
type LeadTable = {
  findUnique(args: Prisma.LeadFindUniqueArgs & Prisma.AgentLeadFindUniqueArgs): Promise<Row | null>;
  findMany(args: Prisma.LeadFindManyArgs & Prisma.AgentLeadFindManyArgs): Promise<Row[]>;
  create(args: Prisma.LeadCreateArgs & Prisma.AgentLeadCreateArgs): Promise<Row>;
  update(args: Prisma.LeadUpdateArgs & Prisma.AgentLeadUpdateArgs): Promise<unknown>;
  updateMany(args: Prisma.LeadUpdateManyArgs & Prisma.AgentLeadUpdateManyArgs): Promise<{ count: number }>;
  deleteMany(args: Prisma.LeadDeleteManyArgs & Prisma.AgentLeadDeleteManyArgs): Promise<{ count: number }>;
  count(args: Prisma.LeadCountArgs & Prisma.AgentLeadCountArgs): Promise<number>;
};
type ActivityTable = { create(args: Prisma.LeadActivityCreateArgs & Prisma.AgentLeadActivityCreateArgs): Promise<unknown> };
type SendLogTable = {
  create(args: Prisma.LeadEmailSendLogCreateArgs & Prisma.EmailSendLogCreateArgs): Promise<unknown>;
  findFirst(args: Prisma.LeadEmailSendLogFindFirstArgs & Prisma.EmailSendLogFindFirstArgs): Promise<{ id: string } | null>;
  update(args: Prisma.LeadEmailSendLogUpdateArgs & Prisma.EmailSendLogUpdateArgs): Promise<unknown>;
  count(args: Prisma.LeadEmailSendLogCountArgs & Prisma.EmailSendLogCountArgs): Promise<number>;
};

// What the adapter reads back must exist, with the same type, on both models.
type SharedRow = Omit<Row, "company" | "brokerage" | "county">;
type HasColumns<Model, Columns> =
  Model extends Pick<Columns, keyof Columns & keyof Model> ? (keyof Columns extends keyof Model ? true : false) : false;
const rowColumnsExist: [HasColumns<Lead, SharedRow>, HasColumns<AgentLead, SharedRow>] = [true, true];
void rowColumnsExist;

type PipelineSpec = {
  id: PipelineId;
  senderEmail: string;
  buildEmail: PipelineAdapter["buildEmail"];
  leads: (db: Db) => LeadTable;
  sendLogs: (db: Db) => SendLogTable;
  activities: (db: Db) => ActivityTable;
  /** Columns only this pipeline's lead table has, for a new lead. */
  ownColumns: (data: NewLeadData) => Record<string, string | null>;
  /** Extra columns searched besides name and email. */
  searchColumns: string[];
};

function toOutreach(row: Row): OutreachLead {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    address: row.address,
    status: row.status,
    website: row.website,
    city: row.city,
    state: row.state,
    sendBlockedReason: row.sendBlockedReason,
    sendRefusalCount: row.sendRefusalCount,
    lastEmailedAt: row.lastEmailedAt,
    repliedAt: row.repliedAt,
    notes: row.notes,
    emailEvidence: row.emailEvidence,
    company: row.company ?? null,
    brokerage: row.brokerage ?? null,
    county: row.county ?? null,
  };
}

function makeAdapter(spec: PipelineSpec): PipelineAdapter {
  const { leads, sendLogs, activities } = spec;
  return {
    id: spec.id,
    label: PIPELINE_LABEL[spec.id],
    basePath: PIPELINE_BASE_PATH[spec.id],
    senderEmail: spec.senderEmail,
    buildEmail: spec.buildEmail,
    async findLead(db, id) {
      const lead = await leads(db).findUnique({ where: { id } });
      return lead && toOutreach(lead);
    },
    async findLeadsByEmail(db, email, excludeId) {
      const rows = await leads(db).findMany({
        where: { email: email.toLowerCase(), ...(excludeId ? { id: { not: excludeId } } : {}) },
        orderBy: { createdAt: "asc" },
      });
      return rows.map(toOutreach);
    },
    async findSameNamed(db, names) {
      const distinct = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
      if (distinct.length === 0) return [];
      const rows = await leads(db).findMany({
        where: { OR: distinct.map((name) => ({ name: { equals: name, mode: "insensitive" } })) },
        select: { id: true, name: true, phone: true, address: true, city: true },
      });
      return rows as NamedLead[];
    },
    async createLead(db, data) {
      const lead = await leads(db).create({
        data: {
          name: data.name,
          email: data.email,
          emailEvidence: data.emailEvidence ?? null,
          emailRulesVersion: data.emailRulesVersion ?? null,
          phone: data.phone,
          address: data.address,
          website: data.website,
          city: data.city,
          state: data.state,
          source: data.source,
          notes: data.notes ?? null,
          emailCheckedAt: data.emailCheckedAt ?? null,
          status: data.status ?? "new",
          ...spec.ownColumns(data),
        },
      });
      return toOutreach(lead);
    },
    async update(db, id, data) {
      await leads(db).update({ where: { id }, data });
    },
    async updateIfStatus(db, id, statuses, data) {
      const { count } = await leads(db).updateMany({ where: { id, status: { in: [...statuses] } }, data });
      return count === 1;
    },
    async claimForSend(db, leadId, email, at) {
      const { count } = await leads(db).updateMany({
        where: { id: leadId, status: "new", email, sendBlockedReason: null },
        data: { status: "contacted", lastEmailedAt: at, repliedAt: null },
      });
      return count === 1;
    },
    async releaseClaim(db, leadId, claimedAt, previous) {
      await leads(db).updateMany({
        where: { id: leadId, status: "contacted", lastEmailedAt: claimedAt },
        data: { status: "new", lastEmailedAt: previous.lastEmailedAt, repliedAt: previous.repliedAt },
      });
    },
    async recordSend(db, leadId, email, providerMessageId, sentAt) {
      await sendLogs(db).create({ data: { leadId, email, providerMessageId, sentAt } });
      await leads(db).updateMany({
        where: { id: leadId },
        data: { lastSendFailedAt: null, lastSendFailure: null, sendRefusalCount: 0 },
      });
    },
    async markLatestSendBounced(db, leadId, at) {
      const log = await sendLogs(db).findFirst({ where: { leadId, bounced: false }, orderBy: { sentAt: "desc" } });
      if (!log) return false;
      await sendLogs(db).update({ where: { id: log.id }, data: { bounced: true, bouncedAt: at } });
      return true;
    },
    async hasBeenEmailed(db, leadId) {
      return (await sendLogs(db).count({ where: { leadId } })) > 0;
    },
    async listSendable(db, limit) {
      const rows = await leads(db).findMany({ where: SENDABLE, orderBy: { createdAt: "asc" }, take: limit });
      return rows.map(toOutreach);
    },
    countSendable: (db) => leads(db).count({ where: SENDABLE }),
    countBlockedNew: (db) => leads(db).count({ where: BLOCKED_NEW }),
    async listStaleContacted(db, cutoff) {
      const rows = await leads(db).findMany({ where: { status: "contacted", lastEmailedAt: { lte: cutoff } } });
      return rows.map(toOutreach);
    },
    async listNeedingEmailLookup(db, limit, retryBefore) {
      const rows = await leads(db).findMany({ where: needsLookup(retryBefore), orderBy: { createdAt: "asc" }, take: limit });
      return rows.map(toOutreach);
    },
    countNeedingEmailLookup: (db, retryBefore) => leads(db).count({ where: needsLookup(retryBefore) }),
    async search(db, query, limit) {
      const q = query.trim();
      if (!q) return [];
      const rows = await leads(db).findMany({
        where: {
          OR: ["name", "email", ...spec.searchColumns].map((column) => ({ [column]: { contains: q, mode: "insensitive" } })),
        },
        orderBy: { updatedAt: "desc" },
        take: limit,
      });
      return rows.map(toOutreach);
    },
    async clearSendBlockedByPrefix(db, email, prefix) {
      await leads(db).updateMany({
        where: { email: email.toLowerCase(), sendBlockedReason: { startsWith: prefix } },
        data: { sendBlockedReason: null },
      });
    },
    async updateIfUnchanged(db, id, expected, data) {
      const { count } = await leads(db).updateMany({ where: { id, status: expected.status, email: expected.email }, data });
      return count === 1;
    },
    async addActivity(db, leadId, entry) {
      await activities(db).create({ data: { leadId, type: entry.type, notes: entry.notes, ...(entry.date ? { date: entry.date } : {}) } });
    },
    async deleteLead(db, id) {
      const { count } = await leads(db).deleteMany({ where: { id } });
      return count === 1;
    },
  };
}

const dataleadsell = makeAdapter({
  id: "dataleadsell",
  senderEmail: DATALEADSELL_SENDER_EMAIL,
  buildEmail: (lead) => buildAgentOutreachEmail(lead.name, lead.county),
  leads: (db) => db.agentLead as unknown as LeadTable,
  sendLogs: (db) => db.emailSendLog as unknown as SendLogTable,
  activities: (db) => db.agentLeadActivity as unknown as ActivityTable,
  ownColumns: (data) => ({ county: data.county ?? null, brokerage: data.brokerage ?? null }),
  searchColumns: ["brokerage", "city"],
});

const coldOutreach = makeAdapter({
  id: "cold-outreach",
  senderEmail: VAULT_PIPELINE_SENDER_EMAIL,
  buildEmail: (lead) => buildOutreachEmail(lead.company || lead.name),
  leads: (db) => db.lead as unknown as LeadTable,
  sendLogs: (db) => db.leadEmailSendLog as unknown as SendLogTable,
  activities: (db) => db.leadActivity as unknown as ActivityTable,
  ownColumns: (data) => ({ company: data.company ?? null }),
  searchColumns: ["company", "city"],
});

const ADAPTERS: Record<PipelineId, PipelineAdapter> = { dataleadsell, "cold-outreach": coldOutreach };

export function getPipeline(id: PipelineId): PipelineAdapter {
  return ADAPTERS[id];
}

export const ALL_PIPELINES: PipelineAdapter[] = [dataleadsell, coldOutreach];
