// The lead stage machine for every pipeline: which statuses exist, what
// they're called on screen, and which manual moves are allowed from each.
// The server rejects anything not listed here, and the lead pages only
// offer what's listed here, so the two can't drift apart.
import type { PipelineId } from "@/lib/outreach/pipeline-id";

export const COLD_OUTREACH_STATUSES = [
  "new",
  "contacted",
  "responded",
  "appointment_set",
  "working_for",
  "paying_client",
  "cold_call_list",
  "contactless_list",
  "lost",
] as const;

export const DATALEADSELL_STATUSES = [
  "new",
  "contacted",
  "responded",
  "subscribed",
  "not_interested",
  "cold_call_list",
  "contactless_list",
  "lost",
] as const;

export const GARBAGE_AI_STATUSES = [
  "new",
  "contacted",
  "responded",
  "demo_booked",
  "signed_up",
  "paying_client",
  "not_interested",
  "cold_call_list",
  "contactless_list",
  "lost",
] as const;

export const ROOM_DESIGNER_STATUSES = [
  "new",
  "contacted",
  "responded",
  "demo_booked",
  "free_week",
  "paying_customer",
  "not_interested",
  "cold_call_list",
  "contactless_list",
  "lost",
] as const;

type ColdOutreachStatus = (typeof COLD_OUTREACH_STATUSES)[number];
type DataleadsellStatus = (typeof DATALEADSELL_STATUSES)[number];
type GarbageAiStatus = (typeof GARBAGE_AI_STATUSES)[number];
type RoomDesignerStatus = (typeof ROOM_DESIGNER_STATUSES)[number];
export type LeadStatus = ColdOutreachStatus | DataleadsellStatus | GarbageAiStatus | RoomDesignerStatus;

const STATUS_LABEL: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  responded: "Responded",
  appointment_set: "Appointment set",
  working_for: "Working for",
  paying_client: "Paying client",
  subscribed: "Subscribed",
  demo_booked: "Demo booked",
  signed_up: "Signed up",
  free_week: "Free week started",
  paying_customer: "Paying customer",
  not_interested: "Not interested",
  cold_call_list: "Cold call list",
  contactless_list: "No phone number",
  lost: "Lost",
};

/** One line on what each status means, shown as the status badge's tooltip and in the glossary on /help. */
export const STATUS_HELP: Record<LeadStatus, string> = {
  new: "Not emailed yet. Gets the first (and only) outreach email.",
  contacted: "Emailed; waiting for a reply. After a week without one it moves to the call deck.",
  responded: "Replied with interest (or you marked the reply). Follow up yourself.",
  appointment_set: "A meeting is booked.",
  working_for: "Doing work for them.",
  paying_client: "Pays for the service.",
  subscribed: "Subscribed to dataleadsell.com.",
  demo_booked: "A demo or walkthrough is booked.",
  signed_up: "Filled out the hauler signup form after the demo.",
  free_week: "Started the free Room Designer 3D week.",
  paying_customer: "Pays for a Room Designer 3D plan.",
  not_interested: "Said no, by reply or on a call (every pipeline but Cold Outreach).",
  cold_call_list: "Didn't reply within a week and has a phone number: on the call deck.",
  contactless_list: "Didn't reply within a week and has no phone number to call.",
  lost: "Closed: opted out, the email bounced, couldn't be reached, or you marked it lost. In Cold Outreach a plain no lands here too.",
};

export const STATUS_COLOR: Record<LeadStatus, string> = {
  new: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  contacted: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  responded: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  appointment_set: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  working_for: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300",
  paying_client: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  subscribed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  demo_booked: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  signed_up: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300",
  free_week: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300",
  paying_customer: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  not_interested: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  cold_call_list: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  contactless_list: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  lost: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

export const STATUS_DOT: Record<LeadStatus, string> = {
  new: "bg-zinc-400",
  contacted: "bg-blue-500",
  responded: "bg-amber-500",
  appointment_set: "bg-purple-500",
  working_for: "bg-cyan-500",
  paying_client: "bg-emerald-500",
  subscribed: "bg-emerald-500",
  demo_booked: "bg-purple-500",
  signed_up: "bg-cyan-500",
  free_week: "bg-cyan-500",
  paying_customer: "bg-emerald-500",
  not_interested: "bg-zinc-400",
  cold_call_list: "bg-orange-500",
  contactless_list: "bg-zinc-400",
  lost: "bg-red-500",
};

const STATUSES: Record<PipelineId, readonly LeadStatus[]> = {
  dataleadsell: DATALEADSELL_STATUSES,
  "cold-outreach": COLD_OUTREACH_STATUSES,
  "garbage-ai": GARBAGE_AI_STATUSES,
  "room-designer": ROOM_DESIGNER_STATUSES,
};

function statusesFor(pipeline: PipelineId): readonly LeadStatus[] {
  return STATUSES[pipeline];
}

/** Where a lead goes when it says no (by reply or on a call): its own stage where the pipeline has one, else Lost. */
/**
 * Statuses a bounce ends outreach for (we were still trying to reach them):
 * "Mark bounced" and a bounce notice move such a lead to Lost
 * (outreach/lead-actions.ts), and the lead page's confirm says so.
 */
export const BOUNCE_MOVES_TO_LOST: readonly string[] = ["contacted", "responded", "cold_call_list", "contactless_list"];

export function declinedStatus(pipeline: PipelineId): "not_interested" | "lost" {
  return pipeline === "cold-outreach" ? "lost" : "not_interested";
}

export function isStatusOf(pipeline: PipelineId, value: string): value is LeadStatus {
  return (statusesFor(pipeline) as readonly string[]).includes(value);
}

/** The on-screen name of a status; one the app doesn't know is shown as such, never raw. */
export function statusLabel(status: string): string {
  return Object.hasOwn(STATUS_LABEL, status) ? STATUS_LABEL[status as LeadStatus] : `Unknown status (${status})`;
}

// Manual moves offered by the Status control. "contacted" is only a manual
// target from Responded, as "undo Mark replied" for a lead that was
// actually emailed — otherwise only a real send puts a lead there, so the
// send ledger always knows who has been pitched. appointment_set is
// reached through the appointment form (it needs a date), not the dropdown.
const COLD_OUTREACH_TRANSITIONS: Record<ColdOutreachStatus, ColdOutreachStatus[]> = {
  new: ["cold_call_list", "contactless_list", "lost"],
  contacted: ["responded", "cold_call_list", "contactless_list", "lost"],
  responded: ["working_for", "paying_client", "cold_call_list", "contacted", "lost"],
  appointment_set: ["working_for", "paying_client", "responded", "lost"],
  working_for: ["paying_client", "lost"],
  paying_client: ["working_for", "lost"],
  cold_call_list: ["responded", "contactless_list", "lost"],
  contactless_list: ["cold_call_list", "lost"],
  lost: ["responded", "cold_call_list"],
};

const DATALEADSELL_TRANSITIONS: Record<DataleadsellStatus, DataleadsellStatus[]> = {
  new: ["cold_call_list", "contactless_list", "not_interested", "lost"],
  contacted: ["responded", "cold_call_list", "contactless_list", "not_interested", "lost"],
  responded: ["subscribed", "not_interested", "cold_call_list", "contacted", "lost"],
  subscribed: ["responded", "lost"],
  not_interested: ["responded", "lost"],
  cold_call_list: ["responded", "contactless_list", "not_interested", "lost"],
  contactless_list: ["cold_call_list", "lost"],
  lost: ["responded", "cold_call_list"],
};

const GARBAGE_AI_TRANSITIONS: Record<GarbageAiStatus, GarbageAiStatus[]> = {
  new: ["cold_call_list", "contactless_list", "not_interested", "lost"],
  contacted: ["responded", "demo_booked", "cold_call_list", "contactless_list", "not_interested", "lost"],
  responded: ["demo_booked", "signed_up", "paying_client", "not_interested", "cold_call_list", "contacted", "lost"],
  demo_booked: ["signed_up", "paying_client", "responded", "not_interested", "lost"],
  signed_up: ["paying_client", "demo_booked", "not_interested", "lost"],
  paying_client: ["signed_up", "lost"],
  not_interested: ["responded", "lost"],
  cold_call_list: ["responded", "demo_booked", "contactless_list", "not_interested", "lost"],
  contactless_list: ["cold_call_list", "lost"],
  lost: ["responded", "cold_call_list"],
};

const ROOM_DESIGNER_TRANSITIONS: Record<RoomDesignerStatus, RoomDesignerStatus[]> = {
  new: ["cold_call_list", "contactless_list", "not_interested", "lost"],
  contacted: ["responded", "demo_booked", "cold_call_list", "contactless_list", "not_interested", "lost"],
  responded: ["demo_booked", "free_week", "paying_customer", "not_interested", "cold_call_list", "contacted", "lost"],
  demo_booked: ["free_week", "paying_customer", "responded", "not_interested", "lost"],
  free_week: ["paying_customer", "demo_booked", "not_interested", "lost"],
  paying_customer: ["free_week", "lost"],
  not_interested: ["responded", "lost"],
  cold_call_list: ["responded", "demo_booked", "contactless_list", "not_interested", "lost"],
  contactless_list: ["cold_call_list", "lost"],
  lost: ["responded", "cold_call_list"],
};

// Appointment set is reached through the appointment form (it needs a
// date), not the status dropdown, from these statuses.
export const APPOINTMENT_FROM: readonly string[] = ["contacted", "responded", "cold_call_list", "appointment_set"];

export function allowedTransitions(pipeline: PipelineId, from: string): LeadStatus[] {
  if (pipeline === "dataleadsell") {
    return DATALEADSELL_TRANSITIONS[from as DataleadsellStatus] ?? [];
  }
  if (pipeline === "garbage-ai") {
    return GARBAGE_AI_TRANSITIONS[from as GarbageAiStatus] ?? [];
  }
  if (pipeline === "room-designer") {
    return ROOM_DESIGNER_TRANSITIONS[from as RoomDesignerStatus] ?? [];
  }
  return COLD_OUTREACH_TRANSITIONS[from as ColdOutreachStatus] ?? [];
}

// Order of progress through the funnel, used to tell a forward move from a
// backward one (which the UI words as "move back").
const RANK: Record<LeadStatus, number> = {
  new: 0,
  cold_call_list: 1,
  contactless_list: 1,
  contacted: 2,
  responded: 3,
  appointment_set: 4,
  demo_booked: 4,
  working_for: 5,
  signed_up: 5,
  free_week: 5,
  subscribed: 6,
  paying_client: 6,
  paying_customer: 6,
  not_interested: 7,
  lost: 7,
};

export function isBackwardMove(from: string, to: string): boolean {
  return (RANK[to as LeadStatus] ?? 0) < (RANK[from as LeadStatus] ?? 0);
}

// Statuses where the relationship is past cold outreach: opting out of
// marketing email doesn't make a client "lost".
export const CUSTOMER_STATUSES: readonly string[] = [
  "working_for",
  "paying_client",
  "subscribed",
  "signed_up",
  "free_week",
  "paying_customer",
];

// --- Replies (every pipeline) ---
// A genuine reply from a lead that was emailed moves it to Responded from
// these statuses — including after the stale-contacts job moved it to
// phone outreach. "Mark replied" on the lead page is offered for the same.
export const REPLY_MOVES_TO_RESPONDED: readonly string[] = ["contacted", "cold_call_list", "contactless_list"];
// A reply to a lead in one of these keeps its status but is flagged
// "Replied — needs review", since it may have got there without a decision
// about this prospect (a bounce, an old call outcome).
export const REPLY_FLAGS_FOR_REVIEW: readonly string[] = ["lost", "not_interested"];

export function canMarkReplied(status: string): boolean {
  return REPLY_MOVES_TO_RESPONDED.includes(status);
}

// --- Cold-call outcomes (every pipeline's call deck) ---
export const COLD_CALL_OUTCOMES = ["no_answer", "invalid_number", "not_interested", "interested"] as const;
export type ColdCallOutcome = (typeof COLD_CALL_OUTCOMES)[number];

export const COLD_CALL_OUTCOME_LABEL: Record<ColdCallOutcome, string> = {
  no_answer: "Didn't answer",
  invalid_number: "Invalid number",
  not_interested: "Not interested",
  interested: "Interested",
};

/** What a cold-call outcome does to a lead, per pipeline. */
export function coldCallResult(pipeline: PipelineId, outcome: ColdCallOutcome): { callOutcome: string; status?: LeadStatus } {
  switch (outcome) {
    case "no_answer":
      return { callOutcome: "no_answer" }; // stays in the list for another try
    case "invalid_number":
      return { callOutcome: "unable_to_contact", status: "lost" };
    case "not_interested":
      return { callOutcome: "not_interested", status: declinedStatus(pipeline) };
    case "interested":
      return { callOutcome: "interested", status: "responded" };
  }
}

// Why a lead was marked Lost by hand (stored in callOutcome, like a call's
// outcome). The one Lost control on a lead page — "Move to… → Lost" — asks
// for one of these before it confirms, in every pipeline.
export const LOST_REASONS = ["not_interested", "too_busy", "no_answer", "no_need", "unable_to_contact"] as const;
type LostReason = (typeof LOST_REASONS)[number];

export function isLostReason(value: unknown): value is LostReason {
  return typeof value === "string" && (LOST_REASONS as readonly string[]).includes(value);
}

/**
 * The Lost reasons a pipeline offers. Where a pipeline has its own "Not
 * interested" stage, a no goes there, so Lost doesn't offer it too — the
 * two can't split the same leads.
 */
export function lostReasonsFor(pipeline: PipelineId): readonly LostReason[] {
  return declinedStatus(pipeline) === "not_interested" ? LOST_REASONS.filter((r) => r !== "not_interested") : LOST_REASONS;
}

/**
 * One line under the "Move to…" picker saying when to use Not interested
 * and when Lost, for a lead that can move to both; null otherwise.
 */
export function closeGuidance(moves: readonly string[]): string | null {
  if (!moves.includes("not_interested") || !moves.includes("lost")) return null;
  return "Said no, by reply or on a call? Choose Not interested. Choose Lost when it ended any other way: no answer, no need, too busy, or no way to reach them.";
}

export const CALL_OUTCOME_LABEL: Record<string, string> = {
  interested: "Interested",
  not_interested: "Not interested",
  too_busy: "Too busy",
  no_answer: "No answer",
  no_need: "No need",
  unable_to_contact: "Unable to contact",
};
