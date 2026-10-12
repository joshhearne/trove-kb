import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales";

/**
 * Dates and numbers are formatted against the active locale, explicitly, never
 * the server's own default (CLAUDE.md).
 */

const dateFormats = new Map<string, Intl.DateTimeFormat>();

function dateFormat(locale: Locale, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}:${JSON.stringify(options)}`;
  let formatter = dateFormats.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    dateFormats.set(key, formatter);
  }
  return formatter;
}

/** An ISO date (YYYY-MM-DD), rendered without timezone drift. */
export function formatDate(iso: string, locale: Locale = DEFAULT_LOCALE): string {
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return dateFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(parsed);
}

export function formatDateTime(date: Date, locale: Locale = DEFAULT_LOCALE): string {
  return dateFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function formatNumber(value: number, locale: Locale = DEFAULT_LOCALE): string {
  return new Intl.NumberFormat(locale).format(value);
}

/**
 * A count of addresses, which can outgrow a number: an IPv6 /64 holds 2^64.
 * Exact for the locale while it fits; after that a power of two for a block,
 * and an approximation for anything else.
 */
export function formatCount(count: bigint, locale: Locale = DEFAULT_LOCALE): string {
  if (count <= BigInt(Number.MAX_SAFE_INTEGER)) return formatNumber(Number(count), locale);
  if ((count & (count - 1n)) === 0n) return `2^${count.toString(2).length - 1}`;
  return `≈ ${new Intl.NumberFormat(locale, { notation: "scientific", maximumSignificantDigits: 3 }).format(Number(count))}`;
}

/** "1 location" / "2 locations", with the count formatted for the locale. */
export function plural(
  count: number,
  singular: string,
  pluralForm: string,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return `${formatNumber(count, locale)} ${count === 1 ? singular : pluralForm}`;
}

/** A file size in the units a person would say it in. */
export function formatBytes(bytes: number, locale: Locale = DEFAULT_LOCALE): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value)} ${units[unit]}`;
}
