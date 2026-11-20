import { describe, expect, it } from "vitest";
import { flagsFor, wikilinkContextSchema } from "./wikilinks";

const A = "0b8f6c1e-3a5d-4c7b-9e2f-1a2b3c4d5e6f";
const B = "1c9f7d2f-4b6e-4d8c-8f3a-2b3c4d5e6f70";
const K1 = "2d0a8e3a-5c7f-4e9d-9a4b-3c4d5e6f7081";
const K2 = "3e1b9f4b-6d8a-4fae-8b5c-4d5e6f708192";

const everyone = { allCompanies: true, companyIds: [], publicAccess: false };
const onlyA = { allCompanies: false, companyIds: [A], publicAccess: false };
const onlyB = { allCompanies: false, companyIds: [B], publicAccess: false };
const published = { allCompanies: true, companyIds: [], publicAccess: true };

describe("flagsFor, from a document", () => {
  const context = { kind: "document" as const, companyId: A };

  it("flags a document of another company, and not one of its own", () => {
    expect(flagsFor(context, { kind: "doc", companyId: B }, null)).toEqual(["otherCompany"]);
    expect(flagsFor(context, { kind: "doc", companyId: A }, null)).toEqual([]);
  });

  it("flags an article its company cannot read, unless the public site shows it", () => {
    expect(flagsFor(context, { kind: "kb", collectionId: K1, publicHidden: false, audience: onlyB }, null)).toEqual(["narrowerCollection"]);
    expect(flagsFor(context, { kind: "kb", collectionId: K1, publicHidden: false, audience: onlyA }, null)).toEqual([]);
    expect(flagsFor(context, { kind: "kb", collectionId: K1, publicHidden: false, audience: { ...onlyB, publicAccess: true } }, null)).toEqual([]);
  });
});

describe("flagsFor, from an article", () => {
  it("always flags a document: its readers include people outside the company", () => {
    expect(flagsFor({ kind: "article", collectionId: K1, publicSite: false }, { kind: "doc", companyId: A }, everyone)).toEqual(["internalDocument"]);
  });

  it("flags an article in a collection fewer companies read", () => {
    const context = { kind: "article" as const, collectionId: K1, publicSite: false };
    expect(flagsFor(context, { kind: "kb", collectionId: K2, publicHidden: false, audience: onlyA }, everyone)).toEqual(["narrowerCollection"]);
    expect(flagsFor(context, { kind: "kb", collectionId: K2, publicHidden: false, audience: everyone }, onlyA)).toEqual([]);
    // The same collection is read by the same people.
    expect(flagsFor(context, { kind: "kb", collectionId: K1, publicHidden: false, audience: onlyA }, everyone)).toEqual([]);
  });

  it("flags an article off the public site, from one on it", () => {
    const context = { kind: "article" as const, collectionId: K1, publicSite: true };
    expect(flagsFor(context, { kind: "kb", collectionId: K1, publicHidden: true, audience: published }, published)).toEqual(["notPublic"]);
    expect(flagsFor(context, { kind: "kb", collectionId: K2, publicHidden: false, audience: published }, published)).toEqual([]);
  });
});

describe("wikilinkContextSchema", () => {
  it("takes a document's or an article's place, and nothing else", () => {
    expect(wikilinkContextSchema.safeParse({ kind: "document", companyId: A, documentId: null }).success).toBe(true);
    expect(wikilinkContextSchema.safeParse({ kind: "article", collectionId: K1, publicSite: true }).success).toBe(true);
    expect(wikilinkContextSchema.safeParse({ kind: "article", collectionId: "x", publicSite: true }).success).toBe(false);
    expect(wikilinkContextSchema.safeParse({ kind: "company", companyId: A }).success).toBe(false);
  });
});
