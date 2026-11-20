import { describe, expect, it } from "vitest";
import { serializeExpandedSteps } from "./kb";
import { nestRunbook } from "@/server/kb/runbook-nest";

const AD = "00000000-0000-4000-8000-000000000002";
const DOC = "00000000-0000-4000-8000-0000000000d0";

describe("serializeExpandedSteps", () => {
  it("lists every step in reading order, keyed by path, with links as Markdown links or labels", async () => {
    const nested = await nestRunbook(
      "root",
      [
        { id: "phone", text: "Order the desk phone", canned: "Phone ordered" },
        { id: "account", text: `[[kb:${AD}|Create the AD account]]` },
      ],
      async (id) =>
        id === AD
          ? { id: AD, title: "AD account", steps: [{ id: "user", text: `Fill in [[doc:${DOC}|the naming rules]]`, note: "See ADUC" }] }
          : null,
    );
    const links = new Map([[`doc:${DOC}`, { href: `https://kb.example.com/documents/${DOC}`, title: "Naming" }]]);
    expect(serializeExpandedSteps(nested, links)).toEqual([
      { id: "phone", step_id: "phone", runbook_id: "root", parent_id: null, depth: 0, group: false, text: "Order the desk phone", canned: "Phone ordered" },
      {
        id: "account",
        step_id: "account",
        runbook_id: "root",
        parent_id: null,
        depth: 0,
        group: true,
        text: "Create the AD account",
        includes: { id: AD, title: "Create the AD account", status: "expanded" },
      },
      {
        id: "account/user",
        step_id: "user",
        runbook_id: AD,
        parent_id: "account",
        depth: 1,
        group: false,
        text: `Fill in [the naming rules](https://kb.example.com/documents/${DOC})`,
        note: "See ADUC",
      },
    ]);
  });
});
