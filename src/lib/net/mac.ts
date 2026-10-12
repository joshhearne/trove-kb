/**
 * MAC addresses and the ways people write them. Shared by the server and the
 * editor, so a pasted address takes the field's format before it is saved.
 */

export const MAC_FORMATS = [
  "colon_upper",
  "colon_lower",
  "hyphen_upper",
  "hyphen_lower",
  "dot_lower",
  "dot_upper",
  "bare_upper",
  "bare_lower",
] as const;

export type MacFormat = (typeof MAC_FORMATS)[number];

/** What a fresh installation uses until an admin chooses. */
export const DEFAULT_MAC_FORMAT: MacFormat = "colon_upper";

export function isMacFormat(value: unknown): value is MacFormat {
  return typeof value === "string" && (MAC_FORMATS as readonly string[]).includes(value);
}

/**
 * The twelve hex digits of a MAC address, lowercase, whatever separators it
 * came with: "78-45-58-8A-DC-95", "7845.588a.dc95", "78:45:58:8a:dc:95".
 * Null when the text is not exactly one address.
 */
export function parseMac(text: string): string | null {
  const digits = text.trim().replace(/[\s:.\-]/g, "");
  return /^[0-9a-f]{12}$/i.test(digits) ? digits.toLowerCase() : null;
}

export function formatMac(digits: string, format: MacFormat): string {
  const upper = format.endsWith("_upper");
  const hex = upper ? digits.toUpperCase() : digits.toLowerCase();
  const pairs = hex.match(/../g) ?? [];

  if (format.startsWith("colon")) return pairs.join(":");
  if (format.startsWith("hyphen")) return pairs.join("-");
  if (format.startsWith("dot")) return (hex.match(/..../g) ?? []).join(".");
  return hex;
}

/** Reformats text that holds one MAC address; anything else comes back unchanged. */
export function normalizeMac(text: string, format: MacFormat): string {
  const digits = parseMac(text);
  return digits ? formatMac(digits, format) : text;
}

/** An example of each format, for pickers and hints. */
export function macFormatExample(format: MacFormat): string {
  return formatMac("7845588adc95", format);
}

/**
 * True when the address was assigned locally rather than burned in by the
 * maker, as phones do with private Wi-Fi addresses.
 */
export function isLocallyAdministered(digits: string): boolean {
  return (parseInt(digits.slice(0, 2), 16) & 0b10) !== 0;
}
