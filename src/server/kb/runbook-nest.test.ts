import { describe, expect, it } from "vitest";
import { flattenNested, includedRunbook, leafSteps, nestRunbook, type RunbookLoader } from "./runbook-nest";

const ONBOARD = "00000000-0000-4000-8000-000000000001";
const AD = "00000000-0000-4000-8000-000000000002";
const MAIL = "00000000-0000-4000-8000-000000000003";
const HIDDEN = "00000000-0000-4000-8000-000000000004";

const books: Record<string, { id: string; title: string; steps: { id: string; text: string; note?: string }[] }> = {
  [AD]: { id: AD, title: "Create the AD account", steps: [{ id: "user", text: "New user in ADUC" }, { id: "groups", text: "Add groups" }] },
  [MAIL]: {
    id: MAIL,
    title: "Set up mail",
    steps: [{ id: "license", text: "Assign a license" }, { id: "ad", text: `[[kb:${AD}]]` }],
  },
  [ONBOARD]: { id: ONBOARD, title: "Onboard", steps: [{ id: "loop", text: `[[kb:${ONBOARD}|Onboard again]]` }] },
};
const load: RunbookLoader = async (id) => books[id] ?? null;

describe("includedRunbook", () => {
  it("is a step that is nothing but a link to an article", () => {
    expect(includedRunbook(`[[kb:${AD}|Create the AD account]]`)).toEqual({ id: AD, label: "Create the AD account" });
    expect(includedRunbook(`  [[kb:${AD}]] `)).toEqual({ id: AD, label: "" });
  });

  it("is not a step with other words, or a link to a document", () => {
    expect(includedRunbook(`See [[kb:${AD}|this]] first`)).toBeNull();
    expect(includedRunbook(`[[doc:${AD}|A doc]]`)).toBeNull();
  });
});

describe("nestRunbook", () => {
  const steps = [
    { id: "desk", text: "Order the desk phone" },
    { id: "account", text: `[[kb:${AD}|Create the AD account]]` },
    { id: "mail", text: `[[kb:${MAIL}]]` },
    { id: "secret", text: `[[kb:${HIDDEN}|Badge access]]` },
  ];

  it("opens each link to a runbook into its steps, and theirs into theirs, with paths for ids", async () => {
    const nested = await nestRunbook("root", steps, load);
    expect(flattenNested(nested).map((step) => [step.path, step.depth, step.text, step.parent])).toEqual([
      ["desk", 0, "Order the desk phone", null],
      ["account", 0, "Create the AD account", null],
      ["account/user", 1, "New user in ADUC", "account"],
      ["account/groups", 1, "Add groups", "account"],
      ["mail", 0, "Set up mail", null],
      ["mail/license", 1, "Assign a license", "mail"],
      ["mail/ad", 1, "Create the AD account", "mail"],
      ["mail/ad/user", 2, "New user in ADUC", "mail/ad"],
      ["mail/ad/groups", 2, "Add groups", "mail/ad"],
      ["secret", 0, "Badge access", null],
    ]);
    expect(nested[1]!.runbook).toEqual({ id: AD, title: "Create the AD account", status: "expanded" });
    expect(nested[1]!.children[0]!.articleId).toBe(AD);
  });

  it("leaves a runbook the reader cannot read as one step, saying so", async () => {
    const nested = await nestRunbook("root", steps, load);
    expect(nested[3]).toMatchObject({ runbook: { id: HIDDEN, title: "Badge access", status: "unavailable" }, children: [] });
  });

  it("counts only the steps ticked themselves", async () => {
    expect(leafSteps(await nestRunbook("root", steps, load)).map((step) => step.path)).toEqual([
      "desk",
      "account/user",
      "account/groups",
      "mail/license",
      "mail/ad/user",
      "mail/ad/groups",
      "secret",
    ]);
  });

  it("stops at a runbook that leads back to itself, and at the depth allowed", async () => {
    const looped = await nestRunbook(ONBOARD, books[ONBOARD]!.steps, load);
    expect(looped[0]!.runbook?.status).toBe("loop");
    const shallow = await nestRunbook("root", [{ id: "mail", text: `[[kb:${MAIL}]]` }], load, { maxDepth: 1 });
    expect(shallow[0]!.children[1]!.runbook?.status).toBe("too-deep");
  });
});
