import { describe, expect, it } from "vitest";
import { uploadArticleSchema } from "./kb-curate";

describe("uploadArticleSchema", () => {
  const collectionId = "0b8f6c1e-3a5d-4c7b-9e2f-1a2b3c4d5e6f";

  it("takes the title from the file when none is typed", () => {
    const parsed = uploadArticleSchema.parse({ collectionId, title: "   ", category: "", subcategory: "" });
    expect(parsed).toMatchObject({ title: null, category: null, subcategory: null, kind: "article", publicHidden: false });
  });

  it("keeps what the person typed, trimmed", () => {
    const parsed = uploadArticleSchema.parse({
      collectionId,
      title: " Join a PC to the domain ",
      category: "Windows",
      subcategory: "Setup",
      kind: "runbook",
      publicHidden: true,
    });
    expect(parsed).toMatchObject({
      title: "Join a PC to the domain",
      category: "Windows",
      subcategory: "Setup",
      kind: "runbook",
      publicHidden: true,
    });
  });

  it("refuses a collection that is not an id, and an overlong title", () => {
    expect(uploadArticleSchema.safeParse({ collectionId: "kb" }).success).toBe(false);
    expect(uploadArticleSchema.safeParse({ collectionId, title: "x".repeat(501) }).success).toBe(false);
  });
});
