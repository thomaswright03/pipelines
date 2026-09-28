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

export const ENV_PAUSED_MESSAGE = `Outbound email is switched off on the server (${OUTBOUND_DISABLED_ENV} is set) — nothing was sent.`;

/** Thrown by the mail layer if anything tries to send while the environment switch is on. */
export class OutboundDisabledError extends Error {
  constructor() {
    super(ENV_PAUSED_MESSAGE);
    this.name = "OutboundDisabledError";
  }
}
