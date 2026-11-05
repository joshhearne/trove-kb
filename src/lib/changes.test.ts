import { describe, expect, it } from "vitest";
import { parseChange, visibleTo } from "./changes";

describe("parseChange", () => {
  it("reads the type, the audience and one bullet", () => {
    expect(
      parseChange("steps", "---\ntype: fix\naudience: everyone\n---\nNumbered steps keep counting.\n"),
    ).toEqual({ id: "steps", kind: "fix", audience: "everyone", items: ["Numbered steps keep counting."] });
  });

  it("defaults the audience to administrators", () => {
    expect(parseChange("a", "---\ntype: feature\n---\nNew.")?.audience).toBe("admins");
  });

  it("accepts aliases and inline comments", () => {
    const entry = parseChange("a", "---\ntype: Added   # a feature\naudience: all\n---\nX");
    expect(entry?.kind).toBe("feature");
    expect(entry?.audience).toBe("everyone");
  });

  it("makes one bullet per list item, joining wrapped lines", () => {
    const entry = parseChange("a", "---\ntype: improvement\n---\n- One\n  continued\n- Two\n");
    expect(entry?.items).toEqual(["One continued", "Two"]);
  });

  it("makes one bullet per paragraph", () => {
    expect(parseChange("a", "---\ntype: fix\n---\nFirst\nline.\n\nSecond.")?.items).toEqual([
      "First line.",
      "Second.",
    ]);
  });

  it("handles Windows line endings", () => {
    expect(parseChange("a", "---\r\ntype: fix\r\n---\r\nDone.\r\n")?.items).toEqual(["Done."]);
  });

  it("refuses a file without a usable type, front matter or body", () => {
    expect(parseChange("a", "---\ntype: chore\n---\nX")).toBeNull();
    expect(parseChange("a", "No front matter")).toBeNull();
    expect(parseChange("a", "---\ntype: fix\n---\n\n")).toBeNull();
  });

  it("caps the length of an item and the number of items", () => {
    const long = "x".repeat(900);
    const many = Array.from({ length: 30 }, (_, i) => `- ${i}`).join("\n");
    expect(parseChange("a", `---\ntype: fix\n---\n${long}`)?.items[0]).toHaveLength(500);
    expect(parseChange("a", `---\ntype: fix\n---\n${many}`)?.items).toHaveLength(20);
  });
});

describe("visibleTo", () => {
  const entries = [
    { id: "a", audience: "everyone" },
    { id: "b", audience: "admins" },
  ];

  it("shows administrators everything", () => {
    expect(visibleTo(entries, true).map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("shows everyone else only what is for everyone", () => {
    expect(visibleTo(entries, false).map((e) => e.id)).toEqual(["a"]);
  });
});
