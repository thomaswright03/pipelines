// A minimal vCard 3.0 for the cold-call deck's "Add to Contacts" link.

/** vCard text-value escaping (RFC 6350 §3.4). */
export function escapeVCardValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\r?\n/g, "\\n");
}

export function buildVCard(name: string, phone: string): string {
  const n = escapeVCardValue(name);
  return ["BEGIN:VCARD", "VERSION:3.0", `N:${n};;;;`, `FN:${n}`, `TEL;TYPE=WORK:${escapeVCardValue(phone)}`, "END:VCARD", ""].join("\r\n");
}

/** A filename-safe version of a lead's name. */
export function vcardFileName(name: string): string {
  return (
    name
      .replace(/[^\w\s-]/g, "")
      .trim()
      .slice(0, 80) || "contact"
  );
}
