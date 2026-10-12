import "server-only";
import { marked } from "marked";
import { sanitizeRichText } from "@/server/fields/sanitize";
import type { FieldDefinition } from "@/server/fields/types";
import { formatCount, formatDate, formatNumber } from "@/i18n/format";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales";
import {
  addressKind,
  describeBlock,
  formatAddress,
  parseCidr,
  parseRange,
  rangeSize,
  type AddressKind,
} from "@/lib/net/ip";
import { formatMac, isLocallyAdministered, parseMac, type MacFormat } from "@/lib/net/mac";
import { asnKind, formatAsn, type AsnKind } from "@/lib/net/asn";
import { formatPortSpec, parsePortSpec, portCount, serviceName, type Protocol } from "@/lib/net/port";
import { effectiveMacFormat } from "@/server/fields/values";

marked.setOptions({ gfm: true, breaks: false });

/** Markdown source to safe HTML. Rendered output goes through the same allowlist. */
export function renderMarkdown(source: string): string {
  return sanitizeRichText(marked.parse(source, { async: false }));
}

export { formatDate, formatDateTime } from "@/i18n/format";

/** The block an address or network sits in, with counts already formatted. */
export type RenderedBlock = {
  network: string;
  mask: string | null;
  wildcard: string | null;
  broadcast: string | null;
  firstUsable: string;
  lastUsable: string;
  usable: string;
  total: string;
};

/** One address or network, worked out. */
export type IpRendered = {
  kind: "ip";
  /** What the field holds: one address, or a whole network. */
  role: "address" | "network";
  address: string;
  prefix: number;
  /** For an address: alone, on a subnet, or the subnet's own address. */
  addressKind: AddressKind;
  /** Null for a single address (/32, /128): there is no block to describe. */
  block: RenderedBlock | null;
};

export type RenderedValue =
  | { kind: "empty" }
  | { kind: "code"; text: string }
  | IpRendered
  /** Several addresses in order; one that no longer parses shows as text. */
  | { kind: "ip_list"; items: (IpRendered | { kind: "text"; text: string })[] }
  | { kind: "range"; start: string; end: string; size: string }
  | { kind: "mac"; text: string; locallyAdministered: boolean }
  | { kind: "asn"; text: string; asn: number; note: AsnKind | null }
  | {
      kind: "port";
      /** As stored and sent by the API: "443/tcp", "5060-5080/udp". */
      value: string;
      /** "443" or "5060–5080", without the protocol. */
      ports: string;
      protocol: Protocol | null;
      /** The well-known service on a single port, such as HTTPS. */
      service: string | null;
      /** How many ports a range covers; null for one port. */
      count: string | null;
    }
  | { kind: "text"; text: string }
  | { kind: "url"; href: string }
  | { kind: "html"; html: string }
  | { kind: "tags"; labels: string[] }
  | { kind: "document"; id: string; title: string }
  | {
      kind: "secret";
      itemId: string;
      label: string;
      username: string | null;
      uri: string | null;
    };

/**
 * Turns a stored value into what the view page should show. Option ids become
 * labels, markdown becomes HTML, and anything unknown falls back to text.
 */
export function renderFieldValue(
  field: FieldDefinition,
  value: unknown,
  optionLabels: Map<string, string>,
  /** Titles of linked documents, for doc_link fields. */
  documentTitles: Map<string, string> = new Map(),
  locale: Locale = DEFAULT_LOCALE,
  /** The instance's MAC format, which mac fields without their own follow. */
  macFormat?: MacFormat,
): RenderedValue {
  if (value === null || value === undefined || value === "") return { kind: "empty" };

  switch (field.fieldType) {
    case "markdown":
      return { kind: "html", html: renderMarkdown(String(value)) };

    case "richtext":
      // Stored sanitized; sanitized again here so older rows cannot bite us.
      return { kind: "html", html: sanitizeRichText(String(value)) };

    case "url":
      return { kind: "url", href: String(value) };

    case "boolean":
      return { kind: "text", text: value === true ? "Yes" : "No" };

    case "ip":
    case "network":
      return renderIp(String(value), field.fieldType === "network" ? "network" : "address", locale);

    case "ip_list": {
      if (!Array.isArray(value) || value.length === 0) return { kind: "empty" };
      return {
        kind: "ip_list",
        items: value.map((item) => renderIp(String(item), "address", locale)),
      };
    }

    case "ip_range": {
      const parsed = parseRange(String(value));
      if (!parsed.ok) return { kind: "text", text: String(value) };
      return {
        kind: "range",
        start: formatAddress(parsed.value.start),
        end: formatAddress(parsed.value.end),
        size: formatCount(rangeSize(parsed.value), locale),
      };
    }

    case "mac": {
      // Shown in the format in force now, whatever it was saved under.
      const digits = parseMac(String(value));
      if (!digits) return { kind: "text", text: String(value) };
      return {
        kind: "mac",
        text: formatMac(digits, effectiveMacFormat(field, macFormat)),
        locallyAdministered: isLocallyAdministered(digits),
      };
    }

    case "hostname":
      return { kind: "code", text: String(value) };

    case "asn": {
      const asn = Number(value);
      if (!Number.isInteger(asn)) return { kind: "text", text: String(value) };
      return { kind: "asn", text: formatAsn(asn), asn, note: asnKind(asn) };
    }

    case "port":
    case "port_range": {
      const parsed = parsePortSpec(String(value), true);
      if (!parsed.ok) return { kind: "text", text: String(value) };
      const spec = parsed.value;
      const single = spec.start === spec.end;
      return {
        kind: "port",
        value: formatPortSpec(spec),
        ports: single ? String(spec.start) : `${spec.start}–${spec.end}`,
        protocol: spec.protocol,
        service: single ? serviceName(spec.start) : null,
        count: single ? null : formatCount(BigInt(portCount(spec)), locale),
      };
    }

    case "vlan":
      return { kind: "text", text: String(value) };

    case "date":
      return { kind: "text", text: formatDate(String(value), locale) };

    case "number":
      return { kind: "text", text: formatNumber(Number(value), locale) };

    case "dropdown": {
      const label = optionLabels.get(String(value));
      return label ? { kind: "text", text: label } : { kind: "empty" };
    }

    case "multi_dropdown": {
      if (!Array.isArray(value) || value.length === 0) return { kind: "empty" };
      const labels = value
        .map((id) => optionLabels.get(String(id)))
        .filter((label): label is string => !!label);
      return labels.length > 0 ? { kind: "tags", labels } : { kind: "empty" };
    }

    case "doc_link": {
      const id = String(value);
      const title = documentTitles.get(id);
      return title ? { kind: "document", id, title } : { kind: "empty" };
    }

    case "secret_ref": {
      // Only the cached non-secret metadata. The password and TOTP are fetched
      // live on reveal and never pass through here.
      if (typeof value !== "object" || value === null) return { kind: "empty" };
      const ref = value as Record<string, unknown>;
      if (typeof ref.item_id !== "string") return { kind: "empty" };
      return {
        kind: "secret",
        itemId: ref.item_id,
        label: typeof ref.label === "string" && ref.label !== "" ? ref.label : "Vault item",
        username: typeof ref.username === "string" ? ref.username : null,
        uri: typeof ref.uri === "string" ? ref.uri : null,
      };
    }

    default:
      return { kind: "text", text: String(value) };
  }
}


/** An address or a network, with its block when it has one. */
function renderIp(
  value: string,
  role: "address" | "network",
  locale: Locale,
): IpRendered | { kind: "text"; text: string } {
  // Older ip values were stored without a prefix: they are one address.
  const parsed = parseCidr(value, "host");
  if (!parsed.ok) return { kind: "text", text: value };
  const cidr = parsed.value;
  const kind = addressKind(cidr);
  const block = role === "network" || kind !== "host" ? describeBlock(cidr) : null;
  return {
    kind: "ip",
    role,
    address: formatAddress(cidr.address),
    prefix: cidr.prefix,
    addressKind: kind,
    block: block && {
      network: block.network,
      mask: block.mask,
      wildcard: block.wildcard,
      broadcast: block.broadcast,
      firstUsable: block.firstUsable,
      lastUsable: block.lastUsable,
      usable: formatCount(block.usable, locale),
      total: formatCount(block.total, locale),
    },
  };
}
