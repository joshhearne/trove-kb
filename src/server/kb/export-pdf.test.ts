import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { extractText, getDocumentProxy } from "unpdf";
import { articlePdf, stampPdf, winAnsi, type ExportMarker } from "./export-pdf";

const marker: ExportMarker = {
  place: "Active Directory › Accounts",
  url: "https://kb.example.com/pub/kb/articles/0b8f6c1e",
  sourceUrl: "https://vendor.example.com/reset",
  exportedAt: "Nov 19, 2026, 9:00 AM",
  labels: { exported: "Exported", source: "Source", page: (page, total) => `Page ${page} of ${total}` },
};

async function pagesText(bytes: Uint8Array): Promise<string[]> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: false });
  return (text as string[]).map((page) => page.replace(/\s+/g, " "));
}

const noImages = async () => null;

describe("winAnsi", () => {
  it("keeps what the standard fonts draw and writes the rest plainly", () => {
    expect(winAnsi("Café “quoted” – €5 › next")).toBe("Café “quoted” – €5 › next");
    expect(winAnsi("Step → done ✓")).toBe("Step -> done v");
    expect(winAnsi("Łódź 日本")).toBe("Lódz ??");
  });
});

describe("articlePdf", () => {
  it("writes the title, the body with its numbers, and the footer on every page", async () => {
    const steps = Array.from({ length: 70 }, (_, index) => `${index + 1}. Step number ${index + 1} of the runbook.`).join("\n");
    const bytes = await articlePdf(
      {
        title: "Reset a user password",
        body: `Intro with **bold** and \`code\`.\n\n${steps}\n\n| Name | Value |\n| --- | --- |\n| Port | 443 |\n\n\`\`\`\nGet-ADUser -Identity jdoe\n\`\`\``,
        format: "markdown",
        meta: ["IDS G2 KB", "Active Directory", "Accounts"],
        instance: "MOT IT",
      },
      marker,
      noImages,
    );
    const pages = await pagesText(bytes);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0]).toContain("Reset a user password");
    // Separately drawn runs read back with a space between them; on the page they touch.
    expect(pages[0]).toMatch(/Intro with bold and code ?\./);
    expect(pages.join(" ")).toContain("70. Step number 70 of the runbook.");
    expect(pages.join(" ")).toContain("Get-ADUser -Identity jdoe");
    for (const [index, page] of pages.entries()) {
      expect(page).toContain("Active Directory › Accounts");
      expect(page).toContain(`Page ${index + 1} of ${pages.length}`);
      expect(page).toContain(marker.url);
      expect(page).toContain("Source: https://vendor.example.com/reset");
      expect(page).toContain("Exported Nov 19, 2026");
    }
    const doc = await PDFDocument.load(bytes);
    expect(doc.getTitle()).toBe("Reset a user password");
  });

  it("names a picture it cannot draw instead of fetching it", async () => {
    const asked: string[] = [];
    const bytes = await articlePdf(
      { title: "Pictures", body: "![The console](https://elsewhere.example.com/a.png)", format: "markdown", meta: [], instance: "X" },
      { ...marker, sourceUrl: null },
      async (src) => {
        asked.push(src);
        return null;
      },
    );
    expect(asked).toEqual(["https://elsewhere.example.com/a.png"]);
    expect((await pagesText(bytes))[0]).toContain("[The console]");
  });
});

describe("stampPdf", () => {
  it("adds the footer to every page of a document that came as a PDF", async () => {
    const source = await PDFDocument.create();
    source.addPage([595, 842]);
    source.addPage([595, 842]);
    const stamped = await stampPdf(await source.save(), { ...marker, sourceUrl: null });
    const pages = await pagesText(stamped);
    expect(pages).toHaveLength(2);
    expect(pages[1]).toContain("Page 2 of 2");
    expect(pages[1]).toContain("Active Directory › Accounts");
    expect(pages[1]).not.toContain("Source:");
  });
});
