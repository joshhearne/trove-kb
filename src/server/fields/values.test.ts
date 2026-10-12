import { describe, expect, it } from "vitest";
import {
  flattenForSearch,
  mergeFieldValues,
  validateFieldValue,
  validateFieldValues,
  type OptionIndex,
} from "./values";
import type { FieldDefinition, FieldType } from "./types";

const LIST = "11111111-1111-4111-8111-111111111111";
const OPTION_A = "22222222-2222-4222-8222-222222222222";
const OPTION_B = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";

const options: OptionIndex = new Map([
  [LIST, [{ id: OPTION_A, label: "Fiber" }, { id: OPTION_B, label: "DSL" }]],
]);

const DOC_A = "55555555-5555-4555-8555-555555555555";
const DOC_B = "66666666-6666-4666-8666-666666666666";

const ctx = {
  options,
  linkTargets: new Map([["field-1", new Map([[DOC_A, "Acme Fiber"]])]]),
};

function field(fieldType: FieldType, overrides: Partial<FieldDefinition> = {}): FieldDefinition {
  return {
    id: "field-1",
    label: "Field",
    fieldType,
    optionListId: fieldType.includes("dropdown") ? LIST : null,
    linkDocTypeId: null,
    required: false,
    sortOrder: 0,
    macFormat: null,
    archivedAt: null,
    docTypeId: "type-1",
    documentId: null,
    ...overrides,
  };
}

function value(type: FieldType, raw: unknown, overrides?: Partial<FieldDefinition>) {
  return validateFieldValue(field(type, overrides), raw, ctx);
}

describe("validateFieldValue", () => {
  it("stores text trimmed", () => {
    expect(value("text", "  Acme  ")).toEqual({ ok: true, value: "Acme" });
  });

  it("treats blank as null when the field is optional", () => {
    expect(value("text", "   ")).toEqual({ ok: true, value: null });
    expect(value("multi_dropdown", [])).toEqual({ ok: true, value: null });
  });

  it("rejects blank when the field is required", () => {
    const result = value("text", "", { required: true, label: "Circuit ID" });
    expect(result).toEqual({ ok: false, message: "Circuit ID is required" });
  });

  it("accepts a number and rejects a string", () => {
    expect(value("number", 42)).toEqual({ ok: true, value: 42 });
    expect(value("number", "forty").ok).toBe(false);
  });

  it("accepts an ISO date and rejects other formats", () => {
    expect(value("date", "2026-03-01")).toEqual({ ok: true, value: "2026-03-01" });
    expect(value("date", "01/03/2026").ok).toBe(false);
  });

  it("accepts http URLs and rejects other schemes", () => {
    expect(value("url", "https://example.com").ok).toBe(true);
    expect(value("url", "javascript:alert(1)").ok).toBe(false);
    expect(value("url", "not a url").ok).toBe(false);
  });

  it("accepts IPv4 and IPv6 and rejects nonsense", () => {
    expect(value("ip", "192.168.1.1").ok).toBe(true);
    expect(value("ip", "2001:db8::1").ok).toBe(true);
    expect(value("ip", "999.1.1.1").ok).toBe(false);
  });

  it("stores booleans", () => {
    expect(value("boolean", true)).toEqual({ ok: true, value: true });
    // false is a real answer, not a blank
    expect(value("boolean", false)).toEqual({ ok: true, value: false });
  });

  it("accepts a dropdown option from its own list only", () => {
    expect(value("dropdown", OPTION_A)).toEqual({ ok: true, value: OPTION_A });
    expect(value("dropdown", OTHER).ok).toBe(false);
  });

  it("accepts multi-select options and rejects duplicates", () => {
    expect(value("multi_dropdown", [OPTION_A, OPTION_B]).ok).toBe(true);
    expect(value("multi_dropdown", [OPTION_A, OPTION_A]).ok).toBe(false);
    expect(value("multi_dropdown", [OPTION_A, OTHER]).ok).toBe(false);
  });

  it("sanitizes richtext on write", () => {
    const result = value("richtext", '<p>ok</p><script>alert(1)</script>');
    expect(result).toEqual({ ok: true, value: "<p>ok</p>" });
  });

  it("treats richtext that sanitizes to nothing as blank", () => {
    expect(value("richtext", "<script>alert(1)</script>")).toEqual({ ok: true, value: null });
  });

  it("keeps markdown source untouched", () => {
    expect(value("markdown", "# Title\n\n- a")).toEqual({ ok: true, value: "# Title\n\n- a" });
  });

  it("accepts a doc_link only for a document the field may reach", () => {
    expect(value("doc_link", DOC_A)).toEqual({ ok: true, value: DOC_A });
    expect(value("doc_link", DOC_B).ok).toBe(false);
  });

  it("refuses field types that are not implemented yet", () => {
    expect(value("secret_ref", { itemId: "x" }).ok).toBe(false);
  });
});

describe("validateFieldValues", () => {
  const fields = [
    field("text", { id: "f-name", label: "Name", required: true }),
    field("number", { id: "f-port", label: "Port" }),
    field("dropdown", { id: "f-type", label: "Type" }),
  ];

  it("ignores fields that were not submitted", () => {
    const result = validateFieldValues(fields, { "f-port": 443 }, ctx);
    expect(result.values).toEqual({ "f-port": 443 });
    expect(result.errors).toEqual({});
  });

  it("collects one error per field", () => {
    const result = validateFieldValues(
      fields,
      { "f-name": "", "f-port": "nope", "f-type": OTHER },
      ctx,
    );
    expect(Object.keys(result.errors).sort()).toEqual(["f-name", "f-port", "f-type"]);
    expect(result.errors["f-name"]).toBe("Name is required");
  });

  it("skips archived fields so their stored values survive", () => {
    const archived = [field("text", { id: "f-old", archivedAt: new Date() })];
    const result = validateFieldValues(archived, { "f-old": "x" }, ctx);
    expect(result.values).toEqual({});
  });
});

describe("mergeFieldValues", () => {
  it("overlays new values on stored ones", () => {
    expect(mergeFieldValues({ a: 1, b: 2 }, { b: 3 })).toEqual({ a: 1, b: 3 });
  });

  it("removes a field that was cleared", () => {
    expect(mergeFieldValues({ a: 1, b: 2 }, { b: null })).toEqual({ a: 1 });
  });

  it("leaves untouched fields alone", () => {
    expect(mergeFieldValues({ a: 1 }, {})).toEqual({ a: 1 });
  });
});

describe("flattenForSearch", () => {
  it("indexes text, numbers, and dates", () => {
    const fields = [
      field("text", { id: "a" }),
      field("number", { id: "b" }),
      field("date", { id: "c" }),
    ];
    const text = flattenForSearch(fields, { a: "Acme", b: 443, c: "2026-03-01" }, ctx);
    expect(text).toBe("Acme 443 2026-03-01");
  });

  it("indexes dropdown labels rather than their ids", () => {
    const fields = [
      field("dropdown", { id: "a" }),
      field("multi_dropdown", { id: "b" }),
    ];
    const text = flattenForSearch(fields, { a: OPTION_A, b: [OPTION_B] }, ctx);
    expect(text).toBe("Fiber DSL");
  });

  it("indexes the readable text of richtext, not its markup", () => {
    const fields = [field("richtext", { id: "a" })];
    expect(flattenForSearch(fields, { a: "<p>Hello <b>world</b></p>" }, ctx)).toBe(
      "Hello world",
    );
  });

  it("indexes the linked document's title, not its id", () => {
    const fields = [field("doc_link", { id: "field-1" })];
    expect(flattenForSearch(fields, { "field-1": DOC_A }, ctx)).toBe("Acme Fiber");
  });

  it("never indexes secrets", () => {
    const fields = [field("secret_ref", { id: "a" })];
    expect(flattenForSearch(fields, { a: { itemId: "abc" } }, ctx)).toBe("");
  });

  it("skips blanks", () => {
    const fields = [field("text", { id: "a" }), field("text", { id: "b" })];
    expect(flattenForSearch(fields, { a: "", b: "kept" }, ctx)).toBe("kept");
  });
});

describe("network field values", () => {
  it("saves an IP address alone as /32, and keeps a chosen prefix", () => {
    expect(value("ip", "192.168.1.10")).toEqual({ ok: true, value: "192.168.1.10/32" });
    expect(value("ip", "2001:DB8::1")).toEqual({ ok: true, value: "2001:db8::1/128" });
    expect(value("ip", "192.168.1.10 255.255.255.0")).toEqual({
      ok: true,
      value: "192.168.1.10/24",
    });
  });

  it("refuses a malformed IP address or prefix", () => {
    expect(value("ip", "192.168.1.300").ok).toBe(false);
    expect(value("ip", "192.168.1.10/33").ok).toBe(false);
    expect(value("ip", "10.0.0.1/24/8").ok).toBe(false);
  });

  it("snaps a network to its boundary and requires a prefix short of one address", () => {
    expect(value("network", "192.168.1.77/24")).toEqual({ ok: true, value: "192.168.1.0/24" });
    expect(value("network", "10.0.0.0/31")).toEqual({ ok: true, value: "10.0.0.0/31" });
    expect(value("network", "192.168.1.0").ok).toBe(false);
    expect(value("network", "192.168.1.5/32").ok).toBe(false);
  });

  it("checks a range's ends", () => {
    expect(value("ip_range", "10.0.0.100 - 10.0.0.199")).toEqual({
      ok: true,
      value: "10.0.0.100-10.0.0.199",
    });
    expect(value("ip_range", "10.0.0.199-10.0.0.100").ok).toBe(false);
  });

  it("writes a MAC address in the field's format, else the instance's", () => {
    const instance = validateFieldValue(field("mac"), "78-45-58-8A-DC-95", {
      ...ctx,
      macFormat: "colon_lower",
    });
    expect(instance).toEqual({ ok: true, value: "78:45:58:8a:dc:95" });

    const own = validateFieldValue(
      field("mac", { macFormat: "dot_upper" }),
      "78:45:58:8a:dc:95",
      { ...ctx, macFormat: "colon_lower" },
    );
    expect(own).toEqual({ ok: true, value: "7845.588A.DC95" });

    expect(value("mac", "78-45-58-8A-DC").ok).toBe(false);
  });

  it("keeps a VLAN ID within 1 to 4094", () => {
    expect(value("vlan", "20")).toEqual({ ok: true, value: 20 });
    expect(value("vlan", 4095).ok).toBe(false);
    expect(value("vlan", "1.5").ok).toBe(false);
  });

  it("lowercases a hostname and drops a trailing dot", () => {
    expect(value("hostname", "FW01.Example.com.")).toEqual({ ok: true, value: "fw01.example.com" });
    expect(value("hostname", "bad host").ok).toBe(false);
    expect(value("hostname", "-fw01").ok).toBe(false);
  });

  it("indexes a MAC under its other spellings, and an address without its prefix", () => {
    const mac = field("mac");
    const ip = field("ip", { id: "field-2" });
    const text = flattenForSearch([mac, ip], {
      [mac.id]: "78-45-58-8A-DC-95",
      [ip.id]: "10.0.0.5/24",
    });
    expect(text).toContain("7845588adc95");
    expect(text).toContain("78:45:58:8a:dc:95");
    expect(text).toContain("78-45-58-8a-dc-95");
    expect(text).toContain("7845.588a.dc95");
    expect(text.split(" ")).toContain("10.0.0.5");
  });
});

describe("IP address lists", () => {
  it("keeps the order and saves each address as an IP address field does", () => {
    expect(value("ip_list", ["8.8.8.8", "1.1.1.1/32", "10.0.0.5 255.255.255.0"])).toEqual({
      ok: true,
      value: ["8.8.8.8/32", "1.1.1.1/32", "10.0.0.5/24"],
    });
  });

  it("splits a string the way a paste is split", () => {
    expect(value("ip_list", "8.8.8.8, 2001:4860:4860::8888")).toEqual({
      ok: true,
      value: ["8.8.8.8/32", "2001:4860:4860::8888/128"],
    });
  });

  it("drops blank rows, and treats an empty list as blank", () => {
    expect(value("ip_list", ["", "8.8.8.8", " "])).toEqual({ ok: true, value: ["8.8.8.8/32"] });
    expect(value("ip_list", [])).toEqual({ ok: true, value: null });
  });

  it("names the address that is wrong, and refuses a repeat", () => {
    const bad = value("ip_list", ["8.8.8.8", "8.8.8.300"]);
    expect(bad.ok === false && bad.message).toContain("Address 2 (8.8.8.300)");
    const repeat = value("ip_list", ["8.8.8.8", "8.8.8.8/32"]);
    expect(repeat.ok === false && repeat.message).toContain("listed twice");
  });

  it("indexes each address with and without its prefix", () => {
    const list = field("ip_list");
    const text = flattenForSearch([list], { [list.id]: ["8.8.8.8/32", "1.1.1.1/32"] });
    expect(text.split(" ")).toEqual(expect.arrayContaining(["8.8.8.8", "1.1.1.1"]));
  });
});

describe("ports", () => {
  it("saves a port with its protocol, and takes a bare number from the API", () => {
    expect(value("port", "TCP 443")).toEqual({ ok: true, value: "443/tcp" });
    expect(value("port", 8443)).toEqual({ ok: true, value: "8443" });
    expect(value("port", "rdp")).toEqual({ ok: true, value: "3389/tcp" });
  });

  it("refuses a range in a port field, and a bad port", () => {
    const range = value("port", "5060-5080");
    expect(range.ok === false && range.message).toContain("Port range field");
    expect(value("port", "70000").ok).toBe(false);
  });

  it("saves a range, and a range of one as a single port", () => {
    expect(value("port_range", "5060:5080 udp")).toEqual({ ok: true, value: "5060-5080/udp" });
    expect(value("port_range", "10000-10000/udp")).toEqual({ ok: true, value: "10000/udp" });
    expect(value("port_range", "5080-5060").ok).toBe(false);
  });

  it("indexes the number, the protocol, and the service", () => {
    const port = field("port");
    const text = flattenForSearch([port], { [port.id]: "443/tcp" });
    expect(text.split(" ")).toEqual(expect.arrayContaining(["443", "tcp", "HTTPS"]));
  });
});

describe("AS numbers", () => {
  it("saves the number however it is written", () => {
    expect(value("asn", "AS13335")).toEqual({ ok: true, value: 13335 });
    expect(value("asn", 65001)).toEqual({ ok: true, value: 65001 });
    expect(value("asn", "0").ok).toBe(false);
  });

  it("indexes it with and without AS", () => {
    const asn = field("asn");
    const text = flattenForSearch([asn], { [asn.id]: 13335 });
    expect(text.split(" ")).toEqual(expect.arrayContaining(["13335", "AS13335"]));
  });
});
