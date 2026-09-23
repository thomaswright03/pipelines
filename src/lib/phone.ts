export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "").slice(0, 10);
}

export function formatPhone(value: string): string {
  const digits = digitsOnly(value);
  if (digits.length === 0) return "";
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)})${digits.slice(3)}`;
  return `(${digits.slice(0, 3)})${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function isValidPhone(value: string): boolean {
  return digitsOnly(value).length === 10;
}
