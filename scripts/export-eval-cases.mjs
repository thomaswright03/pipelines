#!/usr/bin/env node
// Exports recent inbound mail as anonymised, pre-labelled candidates for the
// evaluation sets in tests/corpus/ (docs/measuring-rules.md). Read-only: it runs one SELECT inside a READ ONLY
// transaction and prints to stdout; nothing is written anywhere.
//
//   EVAL_EXPORT_DATABASE_URL=postgres://… node scripts/export-eval-cases.mjs [limit] > cases.json
//
// Each case carries what the app decided (optOut, review, kind) as a
// *suggested* label. Read every case, correct the label where the app was
// wrong, check the anonymisation, and only then paste it into the corpus —
// into the split named by its `split` field (a fixed hash of its text).
// Anonymisation replaces email addresses, phone numbers, URLs and long
// digit runs; it can't find people's or firms' names in free text, so
// replace those by hand. Never commit real addresses or names.
import { createHash } from "node:crypto";
import pg from "pg";

/** Share of cases assigned to the development split; the rest are held out. */
const DEV_SHARE = 0.4;

/**
 * "dev" or "held-out", fixed by a hash of the anonymised text, so the same
 * reply always lands in the same split and nobody chooses which cases are
 * held out.
 */
function splitFor(text) {
  const first = createHash("sha256").update(text).digest()[0];
  return first < DEV_SHARE * 256 ? "dev" : "held-out";
}

const url = process.env.EVAL_EXPORT_DATABASE_URL;
if (!url) {
  console.error("Set EVAL_EXPORT_DATABASE_URL to the database to read from (a read replica or a copy is best).");
  process.exit(2);
}
const limit = Math.min(Math.max(Number.parseInt(process.argv[2] ?? "200", 10) || 200, 1), 2000);

function anonymise(text) {
  if (!text) return text ?? "";
  return text
    .replace(/[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, (m) =>
      /^(mailer-daemon|postmaster)@/i.test(m) ? m.replace(/@.*/, "@mx.example") : "person@example.test",
    )
    .replace(/\bhttps?:\/\/\S+/gi, "https://example.test")
    .replace(/\bwww\.[a-z0-9.-]+\.[a-z]{2,}\S*/gi, "www.example.test")
    .replace(/(?:\+?1[\s.-]*)?\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}\b/g, "(555) 555-0100")
    .replace(/\b\d{6,}\b/g, "000000");
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query("BEGIN TRANSACTION READ ONLY");
  const { rows } = await client.query(
    // The verdict column exists from round 11 on; read through to_jsonb so
    // the script also works on a database without it.
    `SELECT subject, text, "optedOut", "reviewReason", kind, "failedRecipient" IS NOT NULL AS "hasRecipient", "rulesVersion",
            to_jsonb(r) ->> 'verdict' AS verdict
       FROM "InboundReply" r
      -- Leave out the owner's own replies to the reply-loop check (src/lib/outreach/reply-check.ts).
      WHERE NOT EXISTS (SELECT 1 FROM "Lead" l WHERE l.source = 'Reply check (Settings)' AND l.email = r."fromEmail")
      ORDER BY "receivedAt" DESC LIMIT $1`,
    [limit],
  );
  await client.query("ROLLBACK");
  const cases = rows.map((r) => ({
    // Paste the case into REAL_REPLY_DEV or REAL_REPLY_HELD_OUT as this says.
    split: splitFor(anonymise(r.text)),
    subject: anonymise(r.subject),
    text: anonymise(r.text),
    // The outcome the app chose, in the shape tests/corpus/real-replies.ts
    // takes — a suggestion only: correct it before adding the case.
    expected:
      r.kind === "reply" && r.verdict
        ? r.verdict
        : r.optedOut
          ? "opt_out"
          : r.reviewReason !== null
            ? "needs_look"
            : r.kind === "reply"
              ? "positive"
              : r.kind,
    suggested: {
      optOut: r.optedOut,
      review: r.reviewReason !== null,
      verdict: r.verdict,
      kind: r.kind,
      bounceAddressFound: r.hasRecipient,
      rulesVersion: r.rulesVersion,
    },
  }));
  process.stdout.write(`${JSON.stringify(cases, null, 2)}\n`);
  console.error(`Exported ${cases.length} cases. Check each label and the anonymisation before adding any to tests/corpus/.`);
} finally {
  await client.end();
}
