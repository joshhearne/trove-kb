import { describe, expect, it } from "vitest";
import { secretRefSchema } from "./types";
import { serializeFieldValues } from "@/server/api/serializers";
import { flattenForSearch } from "@/server/fields/values";
import { renderFieldValue } from "@/server/fields/render";
import type { FieldDefinition } from "@/server/fields/types";

/**
 * CLAUDE.md: never store, cache, log, export, or webhook a password, TOTP
 * seed, or secure note. These check the paths a value can escape through.
 */

const secretField: FieldDefinition = {
  id: "f-secret",
  label: "Credentials",
  fieldType: "secret_ref",
  optionListId: null,
  linkDocTypeId: null,
  required: false,
  sortOrder: 0,
  macFormat: null,
  archivedAt: null,
  docTypeId: "t",
  documentId: null,
};

const storedRef = {
  provider_id: "11111111-1111-4111-8111-111111111111",
  item_id: "bw-item-1",
  collection_id: "col-1",
  label: "Firewall admin",
  username: "admin",
  uri: "https://10.0.0.1",
};

describe("secretRefSchema", () => {
  it("accepts the documented reference shape", () => {
    expect(secretRefSchema.parse(storedRef)).toEqual(storedRef);
  });

  it("has no field for a password, seed, or note", () => {
    const keys = Object.keys(secretRefSchema.shape);
    expect(keys).toEqual([
      "provider_id",
      "item_id",
      "collection_id",
      "label",
      "username",
      "uri",
    ]);
    for (const forbidden of ["password", "totp", "notes", "secret"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("drops anything extra that a caller tries to smuggle in", () => {
    const parsed = secretRefSchema.parse({ ...storedRef, password: "hunter2", totp: "SEED" });
    expect(JSON.stringify(parsed)).not.toContain("hunter2");
    expect(JSON.stringify(parsed)).not.toContain("SEED");
  });
});

describe("a secret_ref never leaks", () => {
  it("is kept out of the search index entirely", () => {
    expect(flattenForSearch([secretField], { "f-secret": storedRef })).toBe("");
  });

  it("renders as metadata only", () => {
    const rendered = renderFieldValue(secretField, storedRef, new Map());
    expect(rendered).toEqual({
      kind: "secret",
      itemId: "bw-item-1",
      label: "Firewall admin",
      username: "admin",
      uri: "https://10.0.0.1",
    });
  });

  it("carries only the label through the API serializer", () => {
    const [serialized] = serializeFieldValues([secretField], { "f-secret": storedRef }, new Map());
    expect(serialized?.resolved).toBe("Firewall admin");
    expect(serialized?.value).toEqual(storedRef);
  });

  it("is redacted completely in a webhook payload", () => {
    const [serialized] = serializeFieldValues(
      [secretField],
      { "f-secret": storedRef },
      new Map(),
      new Map(),
      true,
    );
    expect(serialized?.value).toBeNull();
    expect(serialized?.resolved).toBeNull();
    expect(JSON.stringify(serialized)).not.toContain("bw-item-1");
  });
});
