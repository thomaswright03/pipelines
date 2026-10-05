// One lock per email address, for everything that decides who an address
// belongs to: a send claiming it (send.ts) and a lead being added or edited
// with it (manual-lead.ts, lead-edit.ts). Two of these on the same address
// run one after the other, so the second sees what the first committed —
// two tabs adding the same address can't both pass the "already used"
// check. A Postgres transaction-level advisory lock: no table or index, and
// it is released when the transaction ends.
import type { Db } from "@/lib/outreach/pipelines";

// An arbitrary constant namespacing this app's address locks (inbound.ts uses its own).
const ADDRESS_LOCK_NAMESPACE = 4242;

/** Holds the address's lock until `tx` (an interactive transaction) ends. `email` must already be trimmed and lower-cased. */
export async function lockAddress(tx: Db, email: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADDRESS_LOCK_NAMESPACE}::int, hashtext(${email}))`;
}
