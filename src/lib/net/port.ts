/**
 * TCP and UDP ports: one port, or a range of them, with an optional protocol.
 * Shared by validation, rendering, and the editor controls, so it imports
 * nothing server-only.
 *
 * Stored as "443/tcp", "5060-5080/udp", or "8443" when no protocol is named.
 */

export const PROTOCOLS = ["tcp", "udp", "tcp+udp"] as const;
export type Protocol = (typeof PROTOCOLS)[number];

export const MIN_PORT = 1;
export const MAX_PORT = 65535;

export type PortSpec = { start: number; end: number; protocol: Protocol | null };

export type PortParseError = "shape" | "number" | "order" | "range";

type Known = { port: number; name: string; protocol: Protocol };

/** Well-known services, named beside a port and accepted in place of one. */
const KNOWN: Known[] = [
  { port: 20, name: "FTP data", protocol: "tcp" },
  { port: 21, name: "FTP", protocol: "tcp" },
  { port: 22, name: "SSH", protocol: "tcp" },
  { port: 23, name: "Telnet", protocol: "tcp" },
  { port: 25, name: "SMTP", protocol: "tcp" },
  { port: 53, name: "DNS", protocol: "tcp+udp" },
  { port: 67, name: "DHCP", protocol: "udp" },
  { port: 69, name: "TFTP", protocol: "udp" },
  { port: 80, name: "HTTP", protocol: "tcp" },
  { port: 88, name: "Kerberos", protocol: "tcp+udp" },
  { port: 110, name: "POP3", protocol: "tcp" },
  { port: 123, name: "NTP", protocol: "udp" },
  { port: 135, name: "RPC", protocol: "tcp" },
  { port: 137, name: "NetBIOS name", protocol: "udp" },
  { port: 138, name: "NetBIOS datagram", protocol: "udp" },
  { port: 139, name: "NetBIOS session", protocol: "tcp" },
  { port: 143, name: "IMAP", protocol: "tcp" },
  { port: 161, name: "SNMP", protocol: "udp" },
  { port: 162, name: "SNMP trap", protocol: "udp" },
  { port: 389, name: "LDAP", protocol: "tcp+udp" },
  { port: 443, name: "HTTPS", protocol: "tcp" },
  { port: 445, name: "SMB", protocol: "tcp" },
  { port: 465, name: "SMTPS", protocol: "tcp" },
  { port: 500, name: "IKE", protocol: "udp" },
  { port: 514, name: "Syslog", protocol: "udp" },
  { port: 587, name: "SMTP submission", protocol: "tcp" },
  { port: 636, name: "LDAPS", protocol: "tcp" },
  { port: 853, name: "DNS over TLS", protocol: "tcp" },
  { port: 993, name: "IMAPS", protocol: "tcp" },
  { port: 995, name: "POP3S", protocol: "tcp" },
  { port: 1194, name: "OpenVPN", protocol: "udp" },
  { port: 1433, name: "SQL Server", protocol: "tcp" },
  { port: 1701, name: "L2TP", protocol: "udp" },
  { port: 1723, name: "PPTP", protocol: "tcp" },
  { port: 1812, name: "RADIUS", protocol: "udp" },
  { port: 1813, name: "RADIUS accounting", protocol: "udp" },
  { port: 3268, name: "Global Catalog", protocol: "tcp" },
  { port: 3269, name: "Global Catalog over TLS", protocol: "tcp" },
  { port: 3306, name: "MySQL", protocol: "tcp" },
  { port: 3389, name: "RDP", protocol: "tcp" },
  { port: 4500, name: "IPsec NAT-T", protocol: "udp" },
  { port: 5060, name: "SIP", protocol: "tcp+udp" },
  { port: 5061, name: "SIP over TLS", protocol: "tcp" },
  { port: 5432, name: "PostgreSQL", protocol: "tcp" },
  { port: 5900, name: "VNC", protocol: "tcp" },
  { port: 8080, name: "HTTP alternate", protocol: "tcp" },
  { port: 8443, name: "HTTPS alternate", protocol: "tcp" },
  { port: 51820, name: "WireGuard", protocol: "udp" },
];

const BY_PORT = new Map(KNOWN.map((k) => [k.port, k]));
const BY_NAME = new Map(KNOWN.map((k) => [k.name.toLowerCase(), k]));

/** The service usually found on a port, such as HTTPS for 443. */
export function serviceName(port: number): string | null {
  return BY_PORT.get(port)?.name ?? null;
}

// "tcp/udp", "TCP & UDP", "udp+tcp", "both": either protocol.
const PROTOCOL_WORD =
  /\b(?:tcp\s*(?:\/|\+|&|,|and)\s*udp|udp\s*(?:\/|\+|&|,|and)\s*tcp|both|tcp|udp)\b/;

function readProtocol(word: string): Protocol {
  if (word === "tcp") return "tcp";
  if (word === "udp") return "udp";
  return "tcp+udp";
}

function readPort(text: string): number | null {
  if (!/^\d{1,5}$/.test(text)) return null;
  const n = Number(text);
  return n >= MIN_PORT && n <= MAX_PORT ? n : null;
}

/**
 * Reads what people type or paste: "443", "443/tcp", "tcp/443", "TCP 443",
 * "udp:53", "5060-5080/udp", "5060:5080 udp", or a known service name such
 * as "https". `allowRange` false refuses a range of more than one port.
 */
export function parsePortSpec(
  text: string,
  allowRange: boolean,
): { ok: true; value: PortSpec } | { ok: false; error: PortParseError } {
  let rest = text.trim().toLowerCase();
  let protocol: Protocol | null = null;
  const word = rest.match(PROTOCOL_WORD);
  if (word) {
    protocol = readProtocol(word[0].replace(/\s+/g, ""));
    rest = rest.replace(word[0], " ");
  }
  rest = rest.replace(/^[\s/:()]+|[\s/:()]+$/g, "");

  const known = BY_NAME.get(rest);
  if (known) {
    return { ok: true, value: { start: known.port, end: known.port, protocol: protocol ?? known.protocol } };
  }

  const range = rest.match(/^(\d+)\s*(?:-|–|—|:|\.\.|to)\s*(\d+)$/);
  const [startText, endText] = range ? [range[1]!, range[2]!] : [rest, rest];
  if (!/^\d+$/.test(startText) || !/^\d+$/.test(endText)) return { ok: false, error: "shape" };
  const start = readPort(startText);
  const end = readPort(endText);
  if (start === null || end === null) return { ok: false, error: "number" };
  if (end < start) return { ok: false, error: "order" };
  if (!allowRange && end !== start) return { ok: false, error: "range" };
  return { ok: true, value: { start, end, protocol } };
}

export function formatPortSpec(spec: PortSpec): string {
  const ports = spec.start === spec.end ? String(spec.start) : `${spec.start}-${spec.end}`;
  return spec.protocol ? `${ports}/${spec.protocol}` : ports;
}

/** How many ports a spec covers. */
export function portCount(spec: PortSpec): number {
  return spec.end - spec.start + 1;
}

/** For the controls: the ports and the protocol, kept apart. */
export function splitPortStored(value: string): { start: string; end: string; protocol: string } {
  const [ports = "", protocol = ""] = value.split("/");
  const [start = "", end = ""] = ports.split("-");
  return { start, end, protocol: (PROTOCOLS as readonly string[]).includes(protocol) ? protocol : "" };
}

export function joinPortStored(start: string, end: string, protocol: string): string {
  const a = start.trim();
  const b = end.trim();
  if (a === "" && b === "") return "";
  const ports = b === "" || b === a ? a : `${a}-${b}`;
  return protocol === "" ? ports : `${ports}/${protocol}`;
}
