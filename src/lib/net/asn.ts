/**
 * Autonomous system numbers: 32-bit (RFC 6793), stored as a plain number.
 * Shared by validation, rendering, and the editor control, so it imports
 * nothing server-only.
 */

export const MIN_ASN = 1;
export const MAX_ASN = 4_294_967_294;

export type AsnParseError = "shape" | "number";

/** What kind of number it is, when it is not an ordinary public one. */
export type AsnKind = "private" | "documentation" | "reserved";

/**
 * Reads "13335", "AS13335", "as 13335", "ASN 13335", and asdot notation
 * ("1.10" is 65546). 0 and 4294967295 are reserved and refused.
 */
export function parseAsn(text: string): { ok: true; value: number } | { ok: false; error: AsnParseError } {
  const rest = text
    .trim()
    .replace(/^asn?\s*:?\s*/i, "")
    .replace(/,/g, "");
  let n: number;
  const dot = rest.match(/^(\d{1,5})\.(\d{1,5})$/);
  if (dot) {
    const high = Number(dot[1]);
    const low = Number(dot[2]);
    if (high > 65535 || low > 65535) return { ok: false, error: "number" };
    n = high * 65536 + low;
  } else if (/^\d{1,10}$/.test(rest)) {
    n = Number(rest);
  } else {
    return { ok: false, error: "shape" };
  }
  if (n < MIN_ASN || n > MAX_ASN) return { ok: false, error: "number" };
  return { ok: true, value: n };
}

export function formatAsn(asn: number): string {
  return `AS${asn}`;
}

/** Private (RFC 6996), documentation (RFC 5398), or otherwise reserved. */
export function asnKind(asn: number): AsnKind | null {
  if ((asn >= 64512 && asn <= 65534) || asn >= 4_200_000_000) return "private";
  if ((asn >= 64496 && asn <= 64511) || (asn >= 65536 && asn <= 65551)) return "documentation";
  if (asn === 23456 || asn === 65535 || (asn >= 65552 && asn <= 131071)) return "reserved";
  return null;
}
