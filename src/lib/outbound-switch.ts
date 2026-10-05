// The out-of-band emergency stop for outbound email. Setting
// OUTBOUND_EMAIL_DISABLED=1 in the hosting environment (Vercel → Project →
// Settings → Environment Variables, then redeploy) stops every send path —
// a single send, a bulk send already in progress, the daily run — exactly
// like the Settings pause, without needing the app, its login or its
// database to be working. It is read on every send, and send-email.ts
// refuses to hand anything to the mail transport while it is set, as a
// last line of defence.
//
// No imports: send-email.ts and the header both use it.

export const OUTBOUND_DISABLED_ENV = "OUTBOUND_EMAIL_DISABLED";

/** Whether the environment switches outbound email off ("1", "true", "yes", "on" — anything but empty/0/false/no/off). */
export function outboundDisabledByEnvironment(env: Record<string, string | undefined> = process.env): boolean {
  const value = env[OUTBOUND_DISABLED_ENV]?.trim().toLowerCase();
  return Boolean(value) && !["0", "false", "no", "off"].includes(value!);
}

// What the operator is told while the switch is on. The operator can't act
// on a variable name, so every message leads with what happened and who to
// ask; the variable and the steps follow in a separate line for whoever
// manages the hosting (the screens show ENV_OFF_DETAIL in smaller type).

/** What is true, in plain words. */
export const ENV_OFF_SUMMARY =
  "Sending is switched off by whoever manages the app's hosting (usually your developer), so nothing is emailed from any pipeline.";
/** Who to ask. */
export const ENV_OFF_ASK = "Ask them to turn it back on when sending should resume — the switch on Settings can't.";
/** The secondary line: what to change, for the person who manages the hosting. */
export const ENV_OFF_DETAIL = `For your developer: the ${OUTBOUND_DISABLED_ENV} environment variable is set. Remove it in the hosting dashboard and redeploy to resume sending.`;

/** A send refused while the switch is on. */
export const ENV_PAUSED_MESSAGE =
  "Sending is switched off by whoever manages the app's hosting, so nothing was sent. Ask your developer to turn it back on.";

/** Thrown by the mail layer if anything tries to send while the environment switch is on. */
export class OutboundDisabledError extends Error {
  constructor() {
    super(`Outbound email is disabled by ${OUTBOUND_DISABLED_ENV}; nothing was sent.`);
    this.name = "OutboundDisabledError";
  }
}
