import { describe, expect, it } from "vitest";
import { groupByDocType, type DocumentListItem } from "./documents";

function doc(overrides: Partial<DocumentListItem> & Pick<DocumentListItem, "id">): DocumentListItem {
  return {
    title: `Doc ${overrides.id}`,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    docTypeId: "type-isp",
    docTypeName: "ISP",
    docTypeIcon: "globe",
    docTypeScope: "location",
    locationId: null,
    locationName: null,
    ...overrides,
  };
}

describe("groupByDocType", () => {
  it("returns nothing for no documents", () => {
    expect(groupByDocType([])).toEqual([]);
  });

  it("collects documents of one type into a single group", () => {
    const groups = groupByDocType([doc({ id: "a" }), doc({ id: "b" })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.documents.map((d) => d.id)).toEqual(["a", "b"]);
  });

  it("keeps the incoming order of both types and documents", () => {
    const groups = groupByDocType([
      doc({ id: "a", docTypeId: "type-firewall", docTypeName: "Firewall" }),
      doc({ id: "b" }),
      doc({ id: "c", docTypeId: "type-firewall", docTypeName: "Firewall" }),
    ]);
    expect(groups.map((g) => g.docType.name)).toEqual(["Firewall", "ISP"]);
    expect(groups[0]?.documents.map((d) => d.id)).toEqual(["a", "c"]);
    expect(groups[1]?.documents.map((d) => d.id)).toEqual(["b"]);
  });

  it("carries the doc type metadata onto the group", () => {
    const [group] = groupByDocType([doc({ id: "a" })]);
    expect(group?.docType).toEqual({
      id: "type-isp",
      name: "ISP",
      icon: "globe",
      scope: "location",
    });
  });
});

import { orderFields } from "./documents";
import type { FieldDefinition } from "@/server/fields/types";

function f(id: string, overrides: Partial<FieldDefinition> = {}): FieldDefinition {
  return {
    id,
    label: id,
    fieldType: "text",
    optionListId: null,
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

describe("orderFields", () => {
  const template = [f("t1"), f("t2")];
  const local = [f("l1", { docTypeId: null, documentId: "doc-1" })];

  it("puts template fields before local fields when there is no override", () => {
    expect(orderFields(template, local, null).map((x) => x.id)).toEqual(["t1", "t2", "l1"]);
  });

  it("treats an empty override as no override", () => {
    expect(orderFields(template, local, []).map((x) => x.id)).toEqual(["t1", "t2", "l1"]);
  });

  it("honors an explicit order", () => {
    expect(orderFields(template, local, ["l1", "t2", "t1"]).map((x) => x.id)).toEqual([
      "l1",
      "t2",
      "t1",
    ]);
  });

  it("appends fields the override does not mention, in natural order", () => {
    expect(orderFields(template, local, ["l1"]).map((x) => x.id)).toEqual(["l1", "t1", "t2"]);
  });

  it("ignores ids in the override that no longer exist", () => {
    expect(orderFields(template, local, ["gone", "t2"]).map((x) => x.id)).toEqual([
      "t2",
      "t1",
      "l1",
    ]);
  });

  it("never drops or duplicates a field", () => {
    const result = orderFields(template, local, ["t2", "t2", "gone"]);
    expect(result.map((x) => x.id).sort()).toEqual(["l1", "t1", "t2"]);
  });
});
