// Which found addresses may be used for which lead.
//
// ADRE and many Yelp listings name an agent *and* their brokerage, and the
// website guess tries the brokerage's name first. The address on a
// brokerage's site is the office's shared inbox (frontdesk@, info@…), not
// the agent's — pitching five agents "Hi <name>" through one front desk is
// exactly what must not happen. So when the site came from the brokerage,
// only an address that is recognisably the agent's own is accepted.

const ROLE_LOCAL_PARTS = new Set([
  "info",
  "hello",
  "hi",
  "contact",
  "contactus",
  "office",
  "admin",
  "support",
  "team",
  "frontdesk",
  "reception",
  "sales",
  "marketing",
  "mail",
  "email",
  "inquiries",
  "inquiry",
  "enquiries",
  "service",
  "customerservice",
  "help",
  "noreply",
  "donotreply",
  "webmaster",
  "hr",
  "careers",
  "jobs",
  "billing",
  "accounting",
  "leads",
  "listings",
  "realestate",
  "homes",
  "properties",
  "broker",
  "brokerage",
]);

/** frontdesk@, info2@, sales.team@ … — an inbox shared by an office, not a person. */
export function isRoleAddress(email: string): boolean {
  const local = (email.split("@")[0] ?? "").toLowerCase();
  const squashed = local.replace(/[^a-z]/g, "");
  if (ROLE_LOCAL_PARTS.has(squashed)) return true;
  const firstToken = local.split(/[._+-]/)[0]!.replace(/\d+$/, "");
  return ROLE_LOCAL_PARTS.has(firstToken);
}

function nameTokens(personName: string): string[] {
  return personName
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((t) => t.length >= 2 && !["jr", "sr", "ii", "iii", "iv"].includes(t));
}

/**
 * Whether the address's local part is plausibly this person's: it contains
 * their first or last name (3+ letters), or first initial + last name.
 */
export function addressMatchesPerson(email: string, personName: string): boolean {
  const local = (email.split("@")[0] ?? "").toLowerCase().replace(/[^a-z]/g, "");
  const tokens = nameTokens(personName);
  if (tokens.length === 0 || !local) return false;
  const first = tokens[0]!;
  const last = tokens[tokens.length - 1]!;
  if (last.length >= 3 && local.includes(last)) return true;
  if (first.length >= 3 && local.includes(first)) return true;
  return tokens.length > 1 && local.startsWith(first[0]! + last);
}

/**
 * The filter for addresses found on a lead's (possibly guessed) site.
 * `siteBasis` "brokerage" means the site belongs to the lead's brokerage,
 * not to the lead.
 */
export function addressFilterFor(
  personName: string,
  siteBasis: "brokerage" | "name" | "given",
): (email: string) => boolean {
  if (siteBasis !== "brokerage") return () => true;
  return (email) => !isRoleAddress(email) && addressMatchesPerson(email, personName);
}
