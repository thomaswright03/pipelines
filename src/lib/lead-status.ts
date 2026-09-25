// The lead stage machine for both pipelines: which statuses exist, what
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

export type ColdOutreachStatus = (typeof COLD_OUTREACH_STATUSES)[number];
export type DataleadsellStatus = (typeof DATALEADSELL_STATUSES)[number];
export type LeadStatus = ColdOutreachStatus | DataleadsellStatus;

const STATUS_LABEL: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  responded: "Responded",
  appointment_set: "Appointment set",
  working_for: "Working for",
  paying_client: "Paying client",
  subscribed: "Subscribed",
  not_interested: "Not interested",
  cold_call_list: "Cold call list",
  contactless_list: "No phone number",
  lost: "Lost",
};

export const STATUS_COLOR: Record<LeadStatus, string> = {
  new: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  contacted: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  responded: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  appointment_set: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  working_for: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300",
  paying_client: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  subscribed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
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
  not_interested: "bg-zinc-400",
  cold_call_list: "bg-orange-500",
  contactless_list: "bg-zinc-400",
  lost: "bg-red-500",
};

function statusesFor(pipeline: PipelineId): readonly LeadStatus[] {
  return pipeline === "dataleadsell" ? DATALEADSELL_STATUSES : COLD_OUTREACH_STATUSES;
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

// Appointment set is reached through the appointment form (it needs a
// date), not the status dropdown, from these statuses.
export const APPOINTMENT_FROM: readonly string[] = ["contacted", "responded", "cold_call_list", "appointment_set"];

export function allowedTransitions(pipeline: PipelineId, from: string): LeadStatus[] {
  if (pipeline === "dataleadsell") {
    return DATALEADSELL_TRANSITIONS[from as DataleadsellStatus] ?? [];
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
  working_for: 5,
  subscribed: 6,
  paying_client: 6,
  not_interested: 7,
  lost: 7,
};

export function isBackwardMove(from: string, to: string): boolean {
  return (RANK[to as LeadStatus] ?? 0) < (RANK[from as LeadStatus] ?? 0);
}

// Statuses where the relationship is past cold outreach: opting out of
// marketing email doesn't make a client "lost".
export const CUSTOMER_STATUSES: readonly string[] = ["working_for", "paying_client", "subscribed"];

// --- Replies (both pipelines) ---
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

// --- Cold-call outcomes (both pipelines' call decks) ---
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
      return { callOutcome: "not_interested", status: pipeline === "dataleadsell" ? "not_interested" : "lost" };
    case "interested":
      return { callOutcome: "interested", status: "responded" };
  }
}

export const CALL_OUTCOME_LABEL: Record<string, string> = {
  interested: "Interested",
  not_interested: "Not interested",
  too_busy: "Too busy",
  no_answer: "No answer",
  no_need: "No need",
  unable_to_contact: "Unable to contact",
};
