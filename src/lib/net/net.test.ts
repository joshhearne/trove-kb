import { describe, expect, it } from "vitest";
import {
  addressKind,
  describeBlock,
  formatAddress,
  formatCidr,
  maskToPrefix,
  parseAddress,
  parseCidr,
  parseRange,
  prefixToMask,
  rangeSize,
  rangeWithin,
  splitAddressInput,
  type Cidr,
} from "@/lib/net/ip";
import { formatMac, isLocallyAdministered, normalizeMac, parseMac } from "@/lib/net/mac";

function cidr(text: string): Cidr {
  const parsed = parseCidr(text, "host");
  if (!parsed.ok) throw new Error(`bad cidr ${text}`);
  return parsed.value;
}

describe("parseAddress / formatAddress", () => {
  it("round-trips IPv4", () => {
    expect(formatAddress(parseAddress(" 192.168.1.10 ")!)).toBe("192.168.1.10");
  });

  it("rejects malformed IPv4", () => {
    for (const bad of ["256.1.1.1", "1.2.3", "01.2.3.4", "1.2.3.4.5", "a.b.c.d", ""]) {
      expect(parseAddress(bad)).toBeNull();
    }
  });

  it("compresses IPv6 per RFC 5952", () => {
    expect(formatAddress(parseAddress("2001:0DB8:0000:0000:0000:0000:0000:0001")!)).toBe(
      "2001:db8::1",
    );
    expect(formatAddress(parseAddress("2001:db8:0:0:1:0:0:1")!)).toBe("2001:db8::1:0:0:1");
    expect(formatAddress(parseAddress("2001:db8:0:1:1:1:1:1")!)).toBe("2001:db8:0:1:1:1:1:1");
    expect(formatAddress(parseAddress("::")!)).toBe("::");
    expect(formatAddress(parseAddress("fe80::")!)).toBe("fe80::");
  });

  it("keeps IPv4-mapped addresses dotted", () => {
    expect(formatAddress(parseAddress("::ffff:192.0.2.1")!)).toBe("::ffff:192.0.2.1");
  });

  it("rejects malformed IPv6", () => {
    for (const bad of ["1::2::3", "12345::", "1:2:3:4:5:6:7:8:9", "fe80::1%eth0", "1:2:3:4:5:6:7"]) {
      expect(parseAddress(bad)).toBeNull();
    }
  });
});

describe("masks and prefixes", () => {
  it("converts both ways", () => {
    expect(prefixToMask(24)).toBe("255.255.255.0");
    expect(prefixToMask(0)).toBe("0.0.0.0");
    expect(maskToPrefix("255.255.255.252")).toBe(30);
    expect(maskToPrefix("255.0.255.0")).toBeNull();
  });

  it("splits pasted text", () => {
    expect(splitAddressInput("10.0.0.5/24")).toEqual({ address: "10.0.0.5", prefix: "24" });
    expect(splitAddressInput("10.0.0.5 255.255.255.0")).toEqual({
      address: "10.0.0.5",
      prefix: "255.255.255.0",
    });
    expect(splitAddressInput("10.0.0.5")).toEqual({ address: "10.0.0.5", prefix: null });
  });

  it("reads a dotted mask after a slash", () => {
    expect(formatCidr(cidr("10.0.0.5/255.255.0.0"))).toBe("10.0.0.5/16");
  });

  it("fills a missing prefix with the host prefix, or reports it", () => {
    expect(formatCidr(cidr("10.0.0.5"))).toBe("10.0.0.5/32");
    expect(formatCidr(cidr("2001:db8::5"))).toBe("2001:db8::5/128");
    expect(parseCidr("10.0.0.0", null)).toEqual({ ok: false, error: "missing" });
  });

  it("refuses an out-of-range prefix", () => {
    expect(parseCidr("10.0.0.5/33", "host")).toEqual({ ok: false, error: "prefix" });
  });
});

describe("describeBlock", () => {
  it("works out an IPv4 /24", () => {
    const block = describeBlock(cidr("192.168.1.77/24"));
    expect(block).toMatchObject({
      network: "192.168.1.0/24",
      mask: "255.255.255.0",
      wildcard: "0.0.0.255",
      broadcast: "192.168.1.255",
      firstUsable: "192.168.1.1",
      lastUsable: "192.168.1.254",
      total: 256n,
      usable: 254n,
    });
  });

  it("counts both addresses of a /31 and the host of a /32", () => {
    expect(describeBlock(cidr("10.0.0.0/31"))).toMatchObject({
      broadcast: null,
      firstUsable: "10.0.0.0",
      lastUsable: "10.0.0.1",
      usable: 2n,
    });
    expect(describeBlock(cidr("10.0.0.9/32"))).toMatchObject({ usable: 1n, firstUsable: "10.0.0.9" });
  });

  it("works out an IPv6 /64", () => {
    const block = describeBlock(cidr("2001:db8::1/64"));
    expect(block.network).toBe("2001:db8::/64");
    expect(block.lastUsable).toBe("2001:db8::ffff:ffff:ffff:ffff");
    expect(block.total).toBe(1n << 64n);
    expect(block.mask).toBeNull();
  });

  it("tells a host from a network address", () => {
    expect(addressKind(cidr("10.0.0.5/32"))).toBe("host");
    expect(addressKind(cidr("10.0.0.5/24"))).toBe("host_in_network");
    expect(addressKind(cidr("10.0.0.0/24"))).toBe("network_address");
    expect(addressKind(cidr("10.0.0.0/31"))).toBe("host_in_network");
  });
});

describe("ranges", () => {
  it("parses and sizes a range", () => {
    const parsed = parseRange("192.168.1.100 – 192.168.1.199");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(rangeSize(parsed.value)).toBe(100n);
    expect(rangeWithin(parsed.value, cidr("192.168.1.0/24"))).toBe(true);
    expect(rangeWithin(parsed.value, cidr("192.168.0.0/24"))).toBe(false);
  });

  it("refuses a backwards or mixed range", () => {
    expect(parseRange("10.0.0.9-10.0.0.1")).toEqual({ ok: false, error: "order" });
    expect(parseRange("10.0.0.1-2001:db8::1")).toEqual({ ok: false, error: "family" });
    expect(parseRange("10.0.0.1")).toEqual({ ok: false, error: "shape" });
  });
});

describe("MAC addresses", () => {
  it("reads any common spelling", () => {
    for (const text of ["78-45-58-8A-DC-95", "78:45:58:8a:dc:95", "7845.588a.dc95", "7845588ADC95"]) {
      expect(parseMac(text)).toBe("7845588adc95");
    }
    expect(parseMac("78-45-58-8A-DC")).toBeNull();
    expect(parseMac("zz:45:58:8a:dc:95")).toBeNull();
  });

  it("writes each format", () => {
    const digits = "7845588adc95";
    expect(formatMac(digits, "colon_lower")).toBe("78:45:58:8a:dc:95");
    expect(formatMac(digits, "colon_upper")).toBe("78:45:58:8A:DC:95");
    expect(formatMac(digits, "hyphen_upper")).toBe("78-45-58-8A-DC-95");
    expect(formatMac(digits, "dot_lower")).toBe("7845.588a.dc95");
    expect(formatMac(digits, "bare_upper")).toBe("7845588ADC95");
  });

  it("reformats a paste and leaves partial text alone", () => {
    expect(normalizeMac("78-45-58-8A-DC-95", "colon_lower")).toBe("78:45:58:8a:dc:95");
    expect(normalizeMac("78-45-5", "colon_lower")).toBe("78-45-5");
  });

  it("spots a locally administered address", () => {
    expect(isLocallyAdministered("7845588adc95")).toBe(false);
    expect(isLocallyAdministered("da45588adc95")).toBe(true);
  });
});
