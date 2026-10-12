/**
 * IPv4 and IPv6 addresses, prefixes, and the blocks they describe. Shared by
 * the server (validation, rendering) and the editor (live preview), so it has
 * no server-only imports.
 *
 * Addresses are held as bigint for both families; the family says how many
 * bits count.
 */

export type IpFamily = 4 | 6;

export type IpAddress = { family: IpFamily; value: bigint };

export function maxPrefix(family: IpFamily): number {
  return family === 4 ? 32 : 128;
}

function bits(family: IpFamily): bigint {
  return BigInt(maxPrefix(family));
}

/* ---------- Parsing ---------- */

const V4_OCTET = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

function parseV4(text: string): bigint | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    if (!V4_OCTET.test(part)) return null;
    value = (value << 8n) | BigInt(Number(part));
  }
  return value;
}

function parseV6(text: string): bigint | null {
  if (text.includes("%")) return null; // zone ids belong to one host's interface, not documentation
  const halves = text.split("::");
  if (halves.length > 2) return null;

  const groups = (part: string): string[] | null => {
    if (part === "") return [];
    const out: string[] = [];
    const pieces = part.split(":");
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i] as string;
      // An embedded IPv4 address may close the last group: ::ffff:192.0.2.1
      if (i === pieces.length - 1 && piece.includes(".")) {
        const v4 = parseV4(piece);
        if (v4 === null) return null;
        out.push(((v4 >> 16n) & 0xffffn).toString(16), (v4 & 0xffffn).toString(16));
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/i.test(piece)) return null;
      out.push(piece);
    }
    return out;
  };

  const head = groups(halves[0] as string);
  const tail = halves.length === 2 ? groups(halves[1] as string) : [];
  if (!head || !tail) return null;

  let all: string[];
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null;
    all = [...head, ...Array<string>(missing).fill("0"), ...tail];
  } else {
    all = head;
  }
  if (all.length !== 8) return null;

  let value = 0n;
  for (const group of all) value = (value << 16n) | BigInt(parseInt(group, 16));
  return value;
}

/** One address, either family, or null when the text is not one. */
export function parseAddress(text: string): IpAddress | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (trimmed.includes(":")) {
    const value = parseV6(trimmed);
    return value === null ? null : { family: 6, value };
  }
  const value = parseV4(trimmed);
  return value === null ? null : { family: 4, value };
}

/* ---------- Formatting ---------- */

function formatV4(value: bigint): string {
  return [24n, 16n, 8n, 0n].map((shift) => String((value >> shift) & 0xffn)).join(".");
}

/** RFC 5952: lowercase, no leading zeros, the longest run of zero groups as "::". */
function formatV6(value: bigint): string {
  // IPv4-mapped addresses read best with the IPv4 part dotted.
  if (value >> 32n === 0xffffn) return `::ffff:${formatV4(value & 0xffffffffn)}`;

  const groups: number[] = [];
  for (let i = 7; i >= 0; i--) groups.push(Number((value >> BigInt(i * 16)) & 0xffffn));

  let bestStart = -1;
  let bestLength = 0;
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > bestLength) {
      bestStart = i;
      bestLength = j - i;
    }
    i = j;
  }

  const hex = groups.map((g) => g.toString(16));
  if (bestLength < 2) return hex.join(":");
  const left = hex.slice(0, bestStart).join(":");
  const right = hex.slice(bestStart + bestLength).join(":");
  return `${left}::${right}`;
}

export function formatAddress(address: IpAddress): string {
  return address.family === 4 ? formatV4(address.value) : formatV6(address.value);
}

/* ---------- Prefixes and masks ---------- */

function maskBits(family: IpFamily, prefix: number): bigint {
  const width = bits(family);
  const all = (1n << width) - 1n;
  return prefix === 0 ? 0n : (all << (width - BigInt(prefix))) & all;
}

/** A dotted IPv4 mask as its prefix length, or null when the mask is not contiguous. */
export function maskToPrefix(mask: string): number | null {
  const value = parseV4(mask.trim());
  if (value === null) return null;
  for (let prefix = 0; prefix <= 32; prefix++) {
    if (maskBits(4, prefix) === value) return prefix;
  }
  return null;
}

/** The dotted IPv4 mask for a prefix length. */
export function prefixToMask(prefix: number): string {
  return formatV4(maskBits(4, prefix));
}

/**
 * Splits what someone typed or pasted into an address and a prefix: "10.0.0.5",
 * "10.0.0.5/24", "10.0.0.5/255.255.255.0", "10.0.0.5 255.255.255.0". The
 * prefix is null when none was given; neither part is validated here.
 */
export function splitAddressInput(text: string): { address: string; prefix: string | null } {
  const trimmed = text.trim();
  const slash = trimmed.match(/^(.+?)\s*\/\s*(\S+)$/);
  if (slash) return { address: slash[1] as string, prefix: slash[2] as string };
  const spaced = trimmed.match(/^(\S+)\s+(?:mask\s+)?(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (spaced) return { address: spaced[1] as string, prefix: spaced[2] as string };
  return { address: trimmed, prefix: null };
}

/**
 * Several addresses pasted at once, separated by commas, semicolons, new
 * lines, or spaces: "8.8.8.8, 1.1.1.1" or "8.8.8.8 1.1.1.1". An address
 * followed by a dotted mask stays one entry: "10.0.0.5 255.255.255.0".
 */
export function splitAddressList(text: string): string[] {
  const out: string[] = [];
  for (const piece of text.split(/[,;\n]+/)) {
    const tokens = piece.trim().split(/\s+/).filter((token) => token !== "");
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i] as string;
      let next = tokens[i + 1];
      let skip = 1;
      if (next?.toLowerCase() === "mask") {
        next = tokens[i + 2];
        skip = 2;
      }
      if (next && !token.includes("/") && !token.includes(":") && maskToPrefix(next) !== null) {
        out.push(`${token} ${next}`);
        i += skip;
      } else {
        out.push(token);
      }
    }
  }
  return out;
}

/** A prefix as typed ("24", "/24", "255.255.255.0") for a family, or null when invalid. */
export function parsePrefix(text: string, family: IpFamily): number | null {
  const trimmed = text.trim().replace(/^\//, "");
  if (/^\d{1,3}$/.test(trimmed)) {
    const prefix = Number(trimmed);
    return prefix <= maxPrefix(family) ? prefix : null;
  }
  if (family === 4 && trimmed.includes(".")) return maskToPrefix(trimmed);
  return null;
}

/* ---------- Address with prefix ---------- */

export type Cidr = { address: IpAddress; prefix: number };

export type CidrParseError = "address" | "prefix" | "mixed";

/**
 * An address with an optional prefix. With no prefix, `defaultPrefix` decides:
 * a number fills it in, null reports it missing.
 */
export function parseCidr(
  text: string,
  defaultPrefix: "host" | null,
): { ok: true; value: Cidr } | { ok: false; error: CidrParseError | "missing" } {
  const { address: addressText, prefix: prefixText } = splitAddressInput(text);
  if (addressText.includes("/")) return { ok: false, error: "mixed" };
  const address = parseAddress(addressText);
  if (!address) return { ok: false, error: "address" };
  if (prefixText === null) {
    if (defaultPrefix === null) return { ok: false, error: "missing" };
    return { ok: true, value: { address, prefix: maxPrefix(address.family) } };
  }
  const prefix = parsePrefix(prefixText, address.family);
  if (prefix === null) return { ok: false, error: "prefix" };
  return { ok: true, value: { address, prefix } };
}

export function formatCidr(cidr: Cidr): string {
  return `${formatAddress(cidr.address)}/${cidr.prefix}`;
}

/** The network address of the block a CIDR sits in. */
export function networkOf(cidr: Cidr): IpAddress {
  return {
    family: cidr.address.family,
    value: cidr.address.value & maskBits(cidr.address.family, cidr.prefix),
  };
}

/* ---------- Blocks ---------- */

export type Block = {
  family: IpFamily;
  prefix: number;
  /** "192.168.1.0/24" */
  network: string;
  /** IPv4 only. */
  mask: string | null;
  wildcard: string | null;
  /** IPv4 only, and only where the block has one (prefix 30 and wider). */
  broadcast: string | null;
  /** The first and last addresses a host can use. */
  firstUsable: string;
  lastUsable: string;
  /** Every address in the block. */
  total: bigint;
  /** The addresses a host can be given. */
  usable: bigint;
};

/**
 * Everything a technician wants to know about the block a CIDR describes.
 * IPv4 /31 links use both addresses (RFC 3021) and /32 is the host itself;
 * IPv6 has no broadcast, so every address counts.
 */
export function describeBlock(cidr: Cidr): Block {
  const { family } = cidr.address;
  const width = bits(family);
  const mask = maskBits(family, cidr.prefix);
  const total = 1n << (width - BigInt(cidr.prefix));
  const network = cidr.address.value & mask;
  const last = network + total - 1n;
  const at = (value: bigint) => formatAddress({ family, value });

  let firstUsable = network;
  let lastUsable = last;
  let usable = total;
  let broadcast: string | null = null;
  if (family === 4 && cidr.prefix <= 30) {
    firstUsable = network + 1n;
    lastUsable = last - 1n;
    usable = total - 2n;
    broadcast = at(last);
  }

  return {
    family,
    prefix: cidr.prefix,
    network: `${at(network)}/${cidr.prefix}`,
    mask: family === 4 ? formatV4(mask) : null,
    wildcard: family === 4 ? formatV4(~mask & 0xffffffffn) : null,
    broadcast,
    firstUsable: at(firstUsable),
    lastUsable: at(lastUsable),
    total,
    usable,
  };
}

/** What a stored address means: one host, or a host on a subnet. */
export type AddressKind = "host" | "host_in_network" | "network_address";

export function addressKind(cidr: Cidr): AddressKind {
  if (cidr.prefix === maxPrefix(cidr.address.family)) return "host";
  return networkOf(cidr).value === cidr.address.value && cidr.prefix < maxPrefix(cidr.address.family) - 1
    ? "network_address"
    : "host_in_network";
}

/* ---------- Ranges ---------- */

export type IpRange = { start: IpAddress; end: IpAddress };

export type RangeParseError = "start" | "end" | "family" | "order" | "shape";

/** "192.168.1.100-192.168.1.199", with or without spaces, "–", or "to". */
export function splitRangeInput(text: string): { start: string; end: string } | null {
  const match = text.trim().match(/^(\S+?)\s*(?:-|–|—|\bto\b)\s*(\S+)$/i);
  if (!match) return null;
  return { start: match[1] as string, end: match[2] as string };
}

export function parseRange(
  text: string,
): { ok: true; value: IpRange } | { ok: false; error: RangeParseError } {
  const parts = splitRangeInput(text);
  if (!parts) return { ok: false, error: "shape" };
  const start = parseAddress(parts.start);
  if (!start) return { ok: false, error: "start" };
  const end = parseAddress(parts.end);
  if (!end) return { ok: false, error: "end" };
  if (start.family !== end.family) return { ok: false, error: "family" };
  if (end.value < start.value) return { ok: false, error: "order" };
  return { ok: true, value: { start, end } };
}

export function formatRange(range: IpRange): string {
  return `${formatAddress(range.start)}-${formatAddress(range.end)}`;
}

export function rangeSize(range: IpRange): bigint {
  return range.end.value - range.start.value + 1n;
}

/** True when the whole range sits inside the block. */
export function rangeWithin(range: IpRange, cidr: Cidr): boolean {
  if (range.start.family !== cidr.address.family) return false;
  const mask = maskBits(cidr.address.family, cidr.prefix);
  const network = cidr.address.value & mask;
  return (range.start.value & mask) === network && (range.end.value & mask) === network;
}
