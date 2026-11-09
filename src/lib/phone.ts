// US phone numbers, stored and shown in one format: "(480) 555-0101".
// Yelp returned E.164 ("+14805550101"), the business list "(208) 555-0101", ADRE and people type anything, so
// every save path goes through normalizePhone().

/** The 10-digit national number, dropping a leading US country code. */
export function digitsOnly(value: string): string {
  let digits = value.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits;
}

/** "(480) 555-0101" for a 10-digit number; anything else is returned trimmed, unchanged. */
export function formatPhone(value: string): string {
  const digits = digitsOnly(value);
  if (digits.length !== 10) return value.trim();
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function isValidPhone(value: string): boolean {
  return digitsOnly(value).length === 10;
}

/** For saving: the formatted number, or null when there's nothing usable. */
export function normalizePhone(value: string | null | undefined): string | null {
  if (!value || !value.trim()) return null;
  return formatPhone(value);
}
