import { describe, expect, it } from "vitest";
import { convertFieldValue, type PreviousField } from "./convert";
import type { OptionIndex } from "./values";
import type { FieldDefinition, FieldType } from "./types";

const NEW_LIST = "22222222-2222-4222-8222-222222222222";
const OLD_FIBER = "33333333-3333-4333-8333-333333333333";
const OLD_CABLE = "44444444-4444-4444-8444-444444444444";
const NEW_FIBER = "55555555-5555-4555-8555-555555555555";
const NEW_DSL = "66666666-6666-4666-8666-666666666666";

const options: OptionIndex = new Map([
  [NEW_LIST, [{ id: NEW_FIBER, label: "Fiber" }, { id: NEW_DSL, label: "DSL" }]],
]);
const optionLabels = new Map([
  [OLD_FIBER, "fiber"],
  [OLD_CABLE, "Cable"],
]);

function field(fieldType: FieldType, overrides: Partial<FieldDefinition> = {}): FieldDefinition {
  return {
    id: "field-1",
    label: "Field",
    fieldType,
    optionListId: fieldType.includes("dropdown") ? NEW_LIST : null,
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

function convert(from: FieldType, to: FieldType, value: unknown, overrides?: Partial<FieldDefinition>) {
  const previous: PreviousField = { fieldType: from, optionLabels };
  return convertFieldValue(previous, field(to, overrides), value, { options });
}

describe("convertFieldValue", () => {
  it("turns numeric text into numbers", () => {
    expect(convert("text", "vlan", "10")).toEqual({ ok: true, value: 10 });
    expect(convert("text", "number", " 2.5 ")).toEqual({ ok: true, value: 2.5 });
    expect(convert("text", "asn", "AS13335")).toEqual({ ok: true, value: 13335 });
  });

  it("turns numbers back into text", () => {
    expect(convert("vlan", "text", 10)).toEqual({ ok: true, value: "10" });
  });

  it("normalizes network values the way a save would", () => {
    expect(convert("text", "ip", "10.0.0.5")).toEqual({ ok: true, value: "10.0.0.5/32" });
    expect(convert("text", "network", "192.168.1.77/24")).toEqual({
      ok: true,
      value: "192.168.1.0/24",
    });
    expect(convert("text", "hostname", "FW01.Example.com.")).toEqual({
      ok: true,
      value: "fw01.example.com",
    });
    expect(convert("text", "mac", "001122aabbcc")).toEqual({ ok: true, value: "00:11:22:AA:BB:CC" });
  });

  it("splits text into lists and joins lists into text", () => {
    expect(convert("text", "ip_list", "1.1.1.1, 8.8.8.8")).toEqual({
      ok: true,
      value: ["1.1.1.1/32", "8.8.8.8/32"],
    });
    expect(convert("ip_list", "text", ["1.1.1.1/32", "8.8.8.8/32"])).toEqual({
      ok: true,
      value: "1.1.1.1/32, 8.8.8.8/32",
    });
    expect(convert("port", "port_list", "443/tcp")).toEqual({ ok: true, value: ["443/tcp"] });
  });

  it("takes a one-item list into a single-value type, but not a longer one", () => {
    expect(convert("ip_list", "ip", ["10.0.0.1/32"])).toEqual({ ok: true, value: "10.0.0.1/32" });
    expect(convert("ip_list", "ip", ["10.0.0.1/32", "10.0.0.2/32"])).toEqual({ ok: false });
  });

  it("matches text to a dropdown option by label, ignoring case", () => {
    expect(convert("text", "dropdown", "fiber")).toEqual({ ok: true, value: NEW_FIBER });
    expect(convert("text", "dropdown", "Satellite")).toEqual({ ok: false });
    expect(convert("text", "multi_dropdown", "DSL, fiber")).toEqual({ ok: false });
    expect(convert("ip_list", "multi_dropdown", ["DSL", "fiber"])).toEqual({
      ok: true,
      value: [NEW_DSL, NEW_FIBER],
    });
  });

  it("carries a dropdown into a new option list, and out to text, by label", () => {
    expect(convert("dropdown", "dropdown", OLD_FIBER)).toEqual({ ok: true, value: NEW_FIBER });
    expect(convert("dropdown", "dropdown", OLD_CABLE)).toEqual({ ok: false });
    expect(convert("dropdown", "text", OLD_CABLE)).toEqual({ ok: true, value: "Cable" });
    expect(convert("multi_dropdown", "text", [OLD_FIBER, OLD_CABLE])).toEqual({
      ok: true,
      value: "fiber, Cable",
    });
  });

  it("reads yes/no words into a boolean, and never writes a boolean out as words", () => {
    expect(convert("text", "boolean", "Yes")).toEqual({ ok: true, value: true });
    expect(convert("text", "boolean", "0")).toEqual({ ok: true, value: false });
    expect(convert("text", "boolean", "maybe")).toEqual({ ok: false });
    expect(convert("boolean", "text", true)).toEqual({ ok: false });
  });

  it("moves between the free-text types", () => {
    expect(convert("richtext", "text", "<p>Call <b>support</b></p>")).toEqual({
      ok: true,
      value: "Call support",
    });
    const html = convert("text", "richtext", "Line one\n\nLine <two>");
    expect(html).toEqual({ ok: true, value: "<p>Line one</p><p>Line &lt;two&gt;</p>" });
    const fromMarkdown = convert("markdown", "richtext", "## VPN\nPort 10443");
    expect(fromMarkdown.ok && String(fromMarkdown.value)).toContain("<h2>VPN</h2>");
  });

  it("keeps values that don't fit, rather than guessing", () => {
    expect(convert("text", "vlan", "ten")).toEqual({ ok: false });
    expect(convert("text", "vlan", "5000")).toEqual({ ok: false });
    expect(convert("text", "ip", "not an address")).toEqual({ ok: false });
    expect(convert("text", "date", "next Tuesday")).toEqual({ ok: false });
  });

  it("never converts document links or secrets", () => {
    expect(convert("doc_link", "text", NEW_FIBER)).toEqual({ ok: false });
    expect(convert("text", "doc_link", NEW_FIBER)).toEqual({ ok: false });
    expect(convert("secret_ref", "text", { id: "x" })).toEqual({ ok: false });
  });

  it("converts into a required field without treating it as blank", () => {
    expect(convert("text", "vlan", "20", { required: true })).toEqual({ ok: true, value: 20 });
  });
});
