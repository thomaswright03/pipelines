// Which mail transport this process uses (see send-email.ts). Kept apart
// from send-email.ts so startup checks and page chrome can read it without
// loading nodemailer.
export type TransportKind = "zeptomail" | "smtp" | "outbox";
export type Env = Record<string, string | undefined>;

export function resolveTransportKind(env: Env = process.env): TransportKind {
  const configured = env.EMAIL_TRANSPORT?.trim().toLowerCase();
  if (configured === "zeptomail" || configured === "smtp" || configured === "outbox") return configured;
  return env.VERCEL ? "zeptomail" : "outbox";
}

type MailDestination = {
  kind: TransportKind;
  /** Whether mail can reach real recipients. */
  delivers: boolean;
  /** For the header pill; null when nothing needs pointing out (live ZeptoMail). */
  badge: string | null;
  /** For Settings: where mail goes, in plain words. */
  description: string;
};

function isLoopback(host: string): boolean {
  const h = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "::1" || /^127\.\d+\.\d+\.\d+$/.test(h);
}

/**
 * Where "sent" mail actually goes. Only the outbox, or an SMTP server on
 * this machine, is described as "nobody receives it": an SMTP host
 * anywhere else may well relay mail to real people.
 */
export function describeMailDestination(env: Env = process.env): MailDestination {
  const kind = resolveTransportKind(env);
  if (kind === "zeptomail") {
    return { kind, delivers: true, badge: null, description: "Live — emails are delivered to recipients through ZeptoMail." };
  }
  if (kind === "outbox") {
    return {
      kind,
      delivers: false,
      badge: "Test mode — emails are saved, not delivered",
      description: "Test mode — emails are saved as files in the outbox folder, not delivered. Nobody receives them.",
    };
  }
  const host = env.SMTP_HOST?.trim();
  if (!host) {
    return {
      kind,
      delivers: false,
      badge: "Mail not set up",
      description:
        "The app is set to send through a mail server, but no server address is set, so every send will fail. Tell your developer the mail server address is missing.",
    };
  }
  const where = `${host}:${env.SMTP_PORT?.trim() || "1025"}`;
  if (isLoopback(host)) {
    return {
      kind,
      delivers: false,
      badge: `Mail captured locally (${where})`,
      description: `Mail goes to ${where} — a local mail catcher on this machine. Nobody receives it.`,
    };
  }
  return {
    kind,
    delivers: true,
    badge: `Mail sent via ${where}`,
    description: `Mail is handed to the SMTP server at ${where}. If that server relays mail, recipients receive it.`,
  };
}
