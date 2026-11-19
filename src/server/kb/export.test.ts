import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { exportFilename, exportOptions, markdownExport, withoutLeadingTitle, withoutStepIds } from "./export";
import { parseFrontmatter } from "./frontmatter";

describe("exportOptions", () => {
  it("offers a PDF first when the article came from one", () => {
    expect(exportOptions({ mime: "application/pdf", name: "guide.pdf" })).toEqual({
      native: "pdf",
      formats: ["pdf", "md"],
      originalName: null,
    });
  });

  it("offers Markdown first otherwise, and the kept file when it is not a PDF", () => {
    expect(exportOptions(null)).toMatchObject({ native: "md", formats: ["md", "pdf"] });
    const docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    expect(exportOptions({ mime: docx, name: "Setup.docx" })).toEqual({
      native: "md",
      formats: ["md", "pdf", "original"],
      originalName: "Setup.docx",
    });
  });
});

describe("exportFilename", () => {
  it("names the file after the title, without characters a file system refuses", () => {
    expect(exportFilename('Reset: a "user" password?', "pdf")).toBe("Reset a user password.pdf");
    expect(exportFilename("  ../..  ", "md")).toBe("article.md");
  });
});

describe("withoutStepIds", () => {
  it("drops the ids a runbook keeps at the end of each step", () => {
    expect(withoutStepIds("1. Open it {#a1b2}\n2. Close it {#c3d4}\nText {#not at end} here")).toBe(
      "1. Open it\n2. Close it\nText {#not at end} here",
    );
  });
});

describe("withoutLeadingTitle", () => {
  it("drops an opening heading that repeats the title, and nothing else", () => {
    expect(withoutLeadingTitle("# Join a PC\n\nText", "Join a PC")).toBe("Text");
    expect(withoutLeadingTitle("# Other\n\nText", "Join a PC")).toBe("# Other\n\nText");
  });
});

describe("markdownExport", () => {
  const base = {
    title: "Reset a user password",
    body: "1. Open the console.\n2. Find the user.\n",
    collection: "IDS G2 KB",
    category: "Active Directory",
    subcategory: "Accounts",
    kind: "runbook" as const,
    sourceUrl: "https://vendor.example.com/reset",
    url: "https://kb.example.com/pub/kb/articles/0b8f6c1e-3a5d-4c7b-9e2f-1a2b3c4d5e6f",
    articleId: "0b8f6c1e-3a5d-4c7b-9e2f-1a2b3c4d5e6f",
    instance: "MOT IT",
    exportedAt: new Date("2026-11-19T15:00:00Z"),
  };

  it("opens with a header naming the address, category and section, then the title", () => {
    const text = markdownExport(base);
    expect(text.startsWith("---\ntitle: Reset a user password\nkb_url: https://kb.example.com/")).toBe(true);
    const header = parse(text.split("---\n")[1] ?? "") as Record<string, string>;
    expect(header).toMatchObject({
      kb_url: base.url,
      category: "Active Directory",
      section: "Accounts",
      collection: "IDS G2 KB",
      source_url: base.sourceUrl,
      kind: "runbook",
      exported_from: "MOT IT",
      exported_at: "2026-11-19T15:00:00.000Z",
    });
    expect(text).toContain("---\n\n# Reset a user password\n\n1. Open the console.\n2. Find the user.\n");
    expect(text.endsWith("user.\n")).toBe(true);
  });

  it("leaves out a section and source that are not there, and does not repeat a title the body has", () => {
    const text = markdownExport({ ...base, subcategory: null, sourceUrl: null, kind: "article", body: "# Reset a user password\n\nText" });
    expect(text).not.toContain("section:");
    expect(text).not.toContain("source_url:");
    expect(text).not.toContain("kind:");
    expect(text.match(/# Reset a user password/g)).toHaveLength(1);
  });

  it("leaves out a runbook's step ids", () => {
    const text = markdownExport({ ...base, body: "1. Open the console. {#a1b2c3d4}\n2. Find the user. {#e5f6a7b8}" });
    expect(text).toContain("1. Open the console.\n2. Find the user.\n");
    expect(text).not.toContain("{#");
  });

  it("reads back through the importer's own front matter parser", () => {
    const { data, body } = parseFrontmatter(markdownExport(base));
    expect(data).toMatchObject({ title: base.title, category: "Active Directory", section: "Accounts" });
    expect(body.trim().startsWith("# Reset a user password")).toBe(true);
  });
});
