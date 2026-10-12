import { describe, expect, it } from "vitest";
import { fieldInputName, readRawValue, readRawValues } from "./form";
import type { FieldDefinition, FieldType } from "./types";

function field(id: string, fieldType: FieldType): FieldDefinition {
  return {
    id,
    label: id,
    fieldType,
    optionListId: null,
    linkDocTypeId: null,
    required: false,
    sortOrder: 0,
    macFormat: null,
    archivedAt: null,
    docTypeId: "t",
    documentId: null,
  };
}

function form(entries: [string, string][]): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

describe("readRawValue", () => {
  it("reads text as a string", () => {
    const f = field("a", "text");
    expect(readRawValue(form([[fieldInputName("a"), " hi "]]), f)).toBe(" hi ");
  });

  it("reads a number, and treats a blank as null", () => {
    const f = field("a", "number");
    expect(readRawValue(form([[fieldInputName("a"), "42"]]), f)).toBe(42);
    expect(readRawValue(form([[fieldInputName("a"), "  "]]), f)).toBeNull();
  });

  it("reads a ticked checkbox as true and an unticked one as false", () => {
    const f = field("a", "boolean");
    // The control always submits a blank; "on" is added only when ticked.
    expect(readRawValue(form([[fieldInputName("a"), ""]]), f)).toBe(false);
    expect(
      readRawValue(form([[fieldInputName("a"), ""], [fieldInputName("a"), "on"]]), f),
    ).toBe(true);
  });

  it("reads multi-select as the ticked ids only", () => {
    const f = field("a", "multi_dropdown");
    const data = form([
      [fieldInputName("a"), ""],
      [fieldInputName("a"), "id-1"],
      [fieldInputName("a"), "id-2"],
    ]);
    expect(readRawValue(data, f)).toEqual(["id-1", "id-2"]);
  });
});

describe("readRawValues", () => {
  const fields = [field("a", "text"), field("b", "text")];

  it("leaves out fields the form did not carry", () => {
    const result = readRawValues(form([[fieldInputName("a"), "kept"]]), fields);
    expect(result).toEqual({ a: "kept" });
    expect("b" in result).toBe(false);
  });

  it("keeps a present but empty field, which means clear it", () => {
    const result = readRawValues(form([[fieldInputName("a"), ""]]), fields);
    expect(result).toEqual({ a: "" });
  });

  it("skips archived fields", () => {
    const archived = [{ ...field("a", "text"), archivedAt: new Date() }];
    expect(readRawValues(form([[fieldInputName("a"), "x"]]), archived)).toEqual({});
  });
});
