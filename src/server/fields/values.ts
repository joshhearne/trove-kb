import { z } from "zod";
import { sanitizeRichText, htmlToText } from "@/server/fields/sanitize";
import type { FieldDefinition, FieldType } from "@/server/fields/types";
import {
  formatAddress,
  formatCidr,
  formatRange,
  maxPrefix,
  networkOf,
  parseCidr,
  parseRange,
  splitAddressList,
  type CidrParseError,
  type RangeParseError,
} from "@/lib/net/ip";
import {
  DEFAULT_MAC_FORMAT,
  formatMac,
  isMacFormat,
  parseMac,
  type MacFormat,
} from "@/lib/net/mac";
import { parseAsn, type AsnParseError } from "@/lib/net/asn";
import {
  formatPortSpec,
  MAX_PORT,
  parsePortSpec,
  serviceName,
  splitPortList,
  type PortParseError,
} from "@/lib/net/port";

/** Option items available to a dropdown field, keyed by option list id. */
export type OptionIndex = Map<string, { id: string; label: string }[]>;

/** Documents a doc_link field may point at: field id -> (document id -> title). */
export type LinkTargetIndex = Map<string, Map<string, string>>;

/**
 * Vault items a secret_ref field may reference: field id -> (item id -> the
 * stored reference). Built from the collections mapped to the company, so a
 * crafted item id cannot reach another client's vault.
 */
export type SecretItemIndex = Map<string, Map<string, Record<string, unknown>>>;

/** Everything validation needs from the database, resolved once per save. */
export type ValidationContext = {
  options?: OptionIndex;
  linkTargets?: LinkTargetIndex;
  secretItems?: SecretItemIndex;
  /** The instance's MAC format, for mac fields that name none of their own. */
  macFormat?: MacFormat;
};

/** The format a mac field writes in: its own, else the instance's. */
export function effectiveMacFormat(
  field: Pick<FieldDefinition, "macFormat">,
  instanceFormat: MacFormat | undefined,
): MacFormat {
  if (isMacFormat(field.macFormat)) return field.macFormat;
  return instanceFormat ?? DEFAULT_MAC_FORMAT;
}

const CIDR_ERRORS: Record<CidrParseError | "missing", string> = {
  address: "Enter an IPv4 or IPv6 address",
  prefix: "Choose a prefix from /0 to /32 (IPv4) or /0 to /128 (IPv6)",
  mixed: "Enter one address with one /prefix",
  missing: "Choose the network's prefix, such as /24",
};

const RANGE_ERRORS: Record<RangeParseError, string> = {
  shape: "Enter a range as first-last, such as 192.168.1.100-192.168.1.199",
  start: "The first address of the range is not an IP address",
  end: "The last address of the range is not an IP address",
  family: "Both ends of a range must be IPv4, or both IPv6",
  order: "The range ends before it starts",
};

/** One host address. A missing prefix means the address alone: /32, or /128. */
const ipSchema = z.string().transform((text, ctx) => {
  const parsed = parseCidr(text, "host");
  if (!parsed.ok) {
    ctx.addIssue({ code: "custom", message: CIDR_ERRORS[parsed.error] });
    return z.NEVER;
  }
  return formatCidr(parsed.value);
});

const MAX_IP_LIST = 32;

/**
 * Several host addresses in order, such as DNS servers: each one as an ip
 * field stores it. A string is split the way a paste is.
 */
const ipListSchema = z
  .union([z.string().transform(splitAddressList), z.array(z.string())], {
    error: "Enter IP addresses",
  })
  .transform((items) => items.map((item) => item.trim()).filter((item) => item !== ""))
  .transform((items, ctx) => {
    if (items.length > MAX_IP_LIST) {
      ctx.addIssue({ code: "custom", message: `List at most ${MAX_IP_LIST} addresses` });
      return z.NEVER;
    }
    const out: string[] = [];
    for (const [index, item] of items.entries()) {
      const parsed = parseCidr(item, "host");
      if (!parsed.ok) {
        ctx.addIssue({
          code: "custom",
          message: `Address ${index + 1} (${item}): ${CIDR_ERRORS[parsed.error]}`,
        });
        return z.NEVER;
      }
      const normalized = formatCidr(parsed.value);
      if (out.includes(normalized)) {
        ctx.addIssue({ code: "custom", message: `${item} is listed twice` });
        return z.NEVER;
      }
      out.push(normalized);
    }
    return out;
  });

/**
 * A block of addresses. The prefix is required and stops short of a single
 * address; host bits are cleared, so 192.168.1.77/24 is kept as 192.168.1.0/24.
 */
const networkSchema = z.string().transform((text, ctx) => {
  const parsed = parseCidr(text, null);
  if (!parsed.ok) {
    ctx.addIssue({ code: "custom", message: CIDR_ERRORS[parsed.error] });
    return z.NEVER;
  }
  const { address, prefix } = parsed.value;
  if (prefix === maxPrefix(address.family)) {
    ctx.addIssue({
      code: "custom",
      message: `A /${prefix} is a single address. Use an IP address field, or choose a wider prefix`,
    });
    return z.NEVER;
  }
  return `${formatAddress(networkOf(parsed.value))}/${prefix}`;
});

const ipRangeSchema = z.string().transform((text, ctx) => {
  const parsed = parseRange(text);
  if (!parsed.ok) {
    ctx.addIssue({ code: "custom", message: RANGE_ERRORS[parsed.error] });
    return z.NEVER;
  }
  return formatRange(parsed.value);
});

const PORT_ERRORS: Record<PortParseError, string> = {
  shape: "Enter a port such as 443, or 443/tcp",
  number: `A port runs from 1 to ${MAX_PORT}`,
  order: "The range ends before it starts",
  range: "Enter one port. Use a Port range field for several",
};

/**
 * One port, or (for port_range) a run of them, with an optional protocol.
 * The API may send a bare number.
 */
function portSchema(allowRange: boolean) {
  return z.union([z.string(), z.number()], { error: PORT_ERRORS.shape }).transform((raw, ctx) => {
    const parsed = parsePortSpec(String(raw), allowRange);
    if (!parsed.ok) {
      ctx.addIssue({
        code: "custom",
        message:
          allowRange && parsed.error === "shape"
            ? "Enter a port or a range such as 5060-5080, or 5060-5080/udp"
            : PORT_ERRORS[parsed.error],
      });
      return z.NEVER;
    }
    return formatPortSpec(parsed.value);
  });
}

const MAX_PORT_LIST = 64;

/**
 * Several ports or ranges, such as what a firewall rule opens: each one as a
 * port_range field stores it, in order. A string is split the way a paste is.
 */
const portListSchema = z
  .union([z.string().transform(splitPortList), z.array(z.union([z.string(), z.number()]))], {
    error: "Enter ports",
  })
  .transform((items) => items.map((item) => String(item).trim()).filter((item) => item !== ""))
  .transform((items, ctx) => {
    if (items.length > MAX_PORT_LIST) {
      ctx.addIssue({ code: "custom", message: `List at most ${MAX_PORT_LIST} ports or ranges` });
      return z.NEVER;
    }
    const out: string[] = [];
    for (const [index, item] of items.entries()) {
      const parsed = parsePortSpec(item, true);
      if (!parsed.ok) {
        ctx.addIssue({
          code: "custom",
          message: `Entry ${index + 1} (${item}): ${
            parsed.error === "shape" ? "Enter a port such as 443/tcp or a range such as 5060-5080/udp" : PORT_ERRORS[parsed.error]
          }`,
        });
        return z.NEVER;
      }
      const normalized = formatPortSpec(parsed.value);
      if (out.includes(normalized)) {
        ctx.addIssue({ code: "custom", message: `${item} is listed twice` });
        return z.NEVER;
      }
      out.push(normalized);
    }
    return out;
  });

const ASN_ERRORS: Record<AsnParseError, string> = {
  shape: "Enter an AS number such as 13335 or AS13335",
  number: "An AS number runs from 1 to 4294967294",
};

/** A 32-bit AS number, saved as a number; "AS13335" and asdot are read too. */
const asnSchema = z
  .union([z.string(), z.number()], { error: ASN_ERRORS.shape })
  .transform((raw, ctx) => {
    const parsed = parseAsn(String(raw));
    if (!parsed.ok) {
      ctx.addIssue({ code: "custom", message: ASN_ERRORS[parsed.error] });
      return z.NEVER;
    }
    return parsed.value;
  });

const HOST_LABEL = /^(?!-)[a-z0-9_-]{1,63}(?<!-)$/;

/** A hostname or fully qualified name; lowercased, trailing dot dropped. */
const hostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((name) => name.replace(/\.$/, ""))
  .refine(
    (name) => name.length <= 253 && name.split(".").every((label) => HOST_LABEL.test(label)),
    "Enter a hostname such as fw01 or fw01.example.com: letters, digits, and hyphens, dot-separated",
  );

const vlanSchema = z.coerce
  .number({ error: "Enter a VLAN ID" })
  .int("A VLAN ID is a whole number")
  .min(1, "A VLAN ID runs from 1 to 4094")
  .max(4094, "A VLAN ID runs from 1 to 4094");

const MAX_TEXT = 10_000;
const MAX_LONG_TEXT = 200_000;

const uuid = z.uuid();

function baseSchema(field: FieldDefinition, ctx: ValidationContext): z.ZodType {
  const options: OptionIndex = ctx.options ?? new Map();
  const allowed = field.optionListId ? (options.get(field.optionListId) ?? []) : [];
  const allowedIds = new Set(allowed.map((o) => o.id));

  switch (field.fieldType) {
    case "text":
      return z.string().trim().max(MAX_TEXT);
    case "markdown":
      return z.string().max(MAX_LONG_TEXT);
    case "richtext":
      return z
        .string()
        .max(MAX_LONG_TEXT)
        .transform((html) => sanitizeRichText(html));
    case "number":
      return z.number({ error: "Enter a number" }).finite();
    case "date":
      return z.iso.date("Enter a date as YYYY-MM-DD");
    case "url":
      return z.url({ protocol: /^https?$/, error: "Enter an http or https URL" }).max(2_000);
    case "ip":
      return ipSchema;
    case "ip_list":
      return ipListSchema;
    case "network":
      return networkSchema;
    case "ip_range":
      return ipRangeSchema;
    case "mac": {
      const format = effectiveMacFormat(field, ctx.macFormat);
      return z.string().transform((text, issue) => {
        const digits = parseMac(text);
        if (!digits) {
          issue.addIssue({
            code: "custom",
            message: "Enter a MAC address: twelve hex digits, with or without separators",
          });
          return z.NEVER;
        }
        return formatMac(digits, format);
      });
    }
    case "vlan":
      return vlanSchema;
    case "hostname":
      return hostnameSchema;
    case "port":
      return portSchema(false);
    case "port_range":
      return portSchema(true);
    case "port_list":
      return portListSchema;
    case "asn":
      return asnSchema;
    case "boolean":
      return z.boolean();
    case "dropdown":
      return uuid.refine((id) => allowedIds.has(id), "Choose one of the listed options");
    case "multi_dropdown":
      return z
        .array(uuid.refine((id) => allowedIds.has(id), "Choose from the listed options"))
        .refine((ids) => new Set(ids).size === ids.length, "Each option can only be chosen once");
    case "doc_link": {
      // Only documents the field is allowed to reach: same company, and the
      // right doc type when the field names one.
      const targets = ctx.linkTargets?.get(field.id);
      return uuid.refine(
        (id) => targets?.has(id) ?? false,
        "Choose one of the documents offered",
      );
    }

    case "secret_ref": {
      // The form posts an item id; what gets stored is the non-secret
      // reference the server resolved for that item.
      const allowed = ctx.secretItems?.get(field.id);
      return z
        .string()
        .refine((id) => allowed?.has(id) ?? false, "Choose one of the vault items offered")
        .transform((id) => allowed?.get(id) as Record<string, unknown>);
    }
  }
}

/** True when a submitted value counts as "left blank". */
export function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

export type FieldValidationResult =
  | { ok: true; value: unknown }
  | { ok: false; message: string };

/** Validates one raw value against its field, sanitizing richtext on the way through. */
export function validateFieldValue(
  field: FieldDefinition,
  raw: unknown,
  ctx: ValidationContext = {},
): FieldValidationResult {
  if (isEmptyValue(raw)) {
    if (field.required) return { ok: false, message: `${field.label} is required` };
    return { ok: true, value: null };
  }

  const parsed = baseSchema(field, ctx).safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid value" };
  }

  // Sanitizing can empty a richtext value entirely; treat that as blank.
  if (isEmptyValue(parsed.data)) {
    if (field.required) return { ok: false, message: `${field.label} is required` };
    return { ok: true, value: null };
  }

  return { ok: true, value: parsed.data };
}

export type FieldValuesResult = {
  values: Record<string, unknown>;
  errors: Record<string, string>;
};

/**
 * Validates a partial map of raw values keyed by field UUID. Fields absent from
 * `raw` are left untouched, which is what `PATCH /documents/:id` needs; fields
 * present with an empty value are cleared.
 */
export function validateFieldValues(
  fields: FieldDefinition[],
  raw: Record<string, unknown>,
  ctx: ValidationContext = {},
): FieldValuesResult {
  const values: Record<string, unknown> = {};
  const errors: Record<string, string> = {};

  for (const field of fields) {
    if (!(field.id in raw)) continue;
    if (field.archivedAt) continue; // archived fields keep their stored value

    const result = validateFieldValue(field, raw[field.id], ctx);
    if (result.ok) {
      values[field.id] = result.value;
    } else {
      errors[field.id] = result.message;
    }
  }

  return { values, errors };
}

/** Merges validated values over the stored ones, dropping cleared fields. */
export function mergeFieldValues(
  stored: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...stored };
  for (const [fieldId, value] of Object.entries(incoming)) {
    if (value === null) delete merged[fieldId];
    else merged[fieldId] = value;
  }
  return merged;
}

/** Flattens values to the plain text that backs `documents.search_text`. */
export function flattenForSearch(
  fields: FieldDefinition[],
  values: Record<string, unknown>,
  ctx: ValidationContext = {},
): string {
  const options: OptionIndex = ctx.options ?? new Map();
  const labelFor = (optionListId: string | null, id: unknown): string => {
    if (!optionListId || typeof id !== "string") return "";
    return options.get(optionListId)?.find((o) => o.id === id)?.label ?? "";
  };

  const parts: string[] = [];

  for (const field of fields) {
    const value = values[field.id];
    if (isEmptyValue(value)) continue;

    switch (field.fieldType) {
      case "richtext":
        parts.push(htmlToText(String(value)));
        break;
      case "dropdown":
        parts.push(labelFor(field.optionListId, value));
        break;
      case "multi_dropdown":
        if (Array.isArray(value)) {
          for (const id of value) parts.push(labelFor(field.optionListId, id));
        }
        break;
      case "boolean":
        parts.push(value === true ? field.label : "");
        break;
      case "doc_link": {
        // Index the linked document's title, not its UUID.
        const title = ctx.linkTargets?.get(field.id)?.get(String(value));
        if (title) parts.push(title);
        break;
      }

      case "ip":
      case "network": {
        // The bare address as well, so a search for it finds the field.
        const text = String(value);
        parts.push(text, text.split("/")[0] ?? "");
        break;
      }

      case "ip_list":
        if (Array.isArray(value)) {
          for (const item of value) parts.push(String(item), String(item).split("/")[0] ?? "");
        }
        break;

      case "ip_range":
        parts.push(String(value).replace("-", " "));
        break;

      case "asn":
        // "AS13335" as well, the way it is usually written.
        parts.push(String(value), `AS${String(value)}`);
        break;

      case "port":
      case "port_range":
        pushPortTerms(parts, String(value));
        break;

      case "port_list":
        if (Array.isArray(value)) for (const item of value) pushPortTerms(parts, String(item));
        break;

      case "mac": {
        // Every common spelling finds it, since the search parser splits each
        // one into different tokens: bare, colons, hyphens, dotted groups.
        const digits = parseMac(String(value));
        if (!digits) {
          parts.push(String(value));
          break;
        }
        const spellings = new Set(
          (["bare_lower", "colon_lower", "hyphen_lower", "dot_lower"] as const).map((format) =>
            formatMac(digits, format),
          ),
        );
        parts.push(...spellings);
        break;
      }

      case "secret_ref":
        // Never indexed: secrets stay out of search entirely (CLAUDE.md).
        break;
      default:
        parts.push(String(value));
    }
  }

  return parts
    .filter((part) => part.trim() !== "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export type { FieldType };

/** A port's search terms: each number, the protocol, and the service's name. */
function pushPortTerms(parts: string[], value: string): void {
  const parsed = parsePortSpec(value, true);
  if (!parsed.ok) {
    parts.push(value);
    return;
  }
  const { start, end, protocol } = parsed.value;
  parts.push(String(start));
  if (end !== start) parts.push(String(end));
  if (protocol) parts.push(...protocol.split("+"));
  const service = start === end ? serviceName(start) : null;
  if (service) parts.push(service);
}
