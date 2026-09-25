import { timingSafeEqual } from "node:crypto";

/**
 * True only when a secret is configured and the header is exactly
 * "Bearer <secret>". An unset secret never authorizes anything (a naive
 * comparison would accept the literal "Bearer undefined").
 */
export function isAuthorizedBearer(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
