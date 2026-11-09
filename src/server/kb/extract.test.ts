import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { categoryFromPath, extractArticle, looksLikeHtml, NotAnArticleError, safeUrl } from "./extract";

const md = (text: string) => Buffer.from(text, "utf8");

/** The smallest PDF that opens: one page, with or without a line of text. */
function pdf(text: string | null): Buffer {
  const stream = text ? `BT /F1 12 Tf 72 720 Td (${text}) Tj ET` : "";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let body = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const at = body.length;
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return at;
  });

  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

function docx(paragraphs: { text: string; style?: string }[]): Buffer {
  const text = (value: string) => new TextEncoder().encode(value);
  const body = paragraphs
    .map(
      ({ text: content, style }) =>
        `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t>${content}</w:t></w:r></w:p>`,
    )
    .join("");

  return Buffer.from(
    zipSync({
      "[Content_Types].xml": text(
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
      "_rels/.rels": text(
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ),
      "word/document.xml": text(
        `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
      ),
    }),
  );
}

describe("extractArticle", () => {
  it("reads a Markdown article and its frontmatter", async () => {
    const article = await extractArticle(
      "articles/Networking/VPN/tunnels-4821.md",
      md(
        '---\ntitle: "Configure tunnels"\narticle_id: 4821\ncategory: "Networking"\nsubcategory: "VPN"\nurl: https://kb.example.com/4821\ndate_created: "2019-08-14"\ndate_modified: "2025-11-11"\ndoc_attachments: ["Tunnel_Guide.pdf"]\nimage_attachments: []\n---\n\n# Configure tunnels\n\nBody.\n',
      ),
    );

    expect(article).toMatchObject({
      title: "Configure tunnels",
      externalId: "4821",
      category: "Networking",
      subcategory: "VPN",
      sourceUrl: "https://kb.example.com/4821",
      sourceType: "md",
      format: "markdown",
      extraction: "ok",
      body: "# Configure tunnels\n\nBody.",
    });
    expect(article.dateCreated?.toISOString()).toBe("2019-08-14T00:00:00.000Z");
    expect(article.metadata).toEqual({
      doc_attachments: ["Tunnel_Guide.pdf"],
      image_attachments: [],
    });
  });

  it("falls back to the first heading, then the file name, for a title", async () => {
    expect((await extractArticle("a/b/setup-guide.md", md("# Setting up\n\nText"))).title).toBe(
      "Setting up",
    );
    expect((await extractArticle("a/b/setup-guide.md", md("Text only"))).title).toBe("setup guide");
  });

  it("takes a category from the folders when the file names none", async () => {
    const article = await extractArticle("articles/Licensing/Renewals/x.md", md("Text"));
    expect(article).toMatchObject({ category: "Licensing", subcategory: "Renewals", externalId: null });
  });

  it("stores plain text as it is", async () => {
    const article = await extractArticle("notes/readme.txt", md("Line one\nLine two\n"));
    expect(article).toMatchObject({ format: "text", sourceType: "txt", body: "Line one\nLine two\n" });
  });

  it("drops a link that is not a web address", async () => {
    const article = await extractArticle("a.md", md("---\nurl: javascript:alert(1)\n---\nText"));
    expect(article.sourceUrl).toBeNull();
  });

  it("reads the text layer of a PDF", async () => {
    const article = await extractArticle("guides/printing.pdf", pdf("Exporting a configuration report"));
    expect(article).toMatchObject({ sourceType: "pdf", extraction: "ok", format: "text" });
    expect(article.body).toContain("Exporting a configuration report");
  });

  it("flags a PDF with no text layer instead of failing", async () => {
    const article = await extractArticle("scans/brochure.pdf", pdf(null));
    expect(article).toMatchObject({ extraction: "unextracted", body: "", title: "brochure" });
  });

  it("goes by the bytes, not the name", async () => {
    const article = await extractArticle("misnamed.txt", pdf("Really a PDF, whatever it is called"));
    expect(article.sourceType).toBe("pdf");
  });

  it("converts a Word document to Markdown", async () => {
    const article = await extractArticle(
      "guides/setup.docx",
      docx([
        { text: "Setting up failover", style: "Heading1" },
        { text: "Open the failover page and choose Setup." },
      ]),
    );
    expect(article).toMatchObject({ sourceType: "docx", format: "markdown", title: "Setting up failover" });
    expect(article.body).toBe("# Setting up failover\n\nOpen the failover page and choose Setup.");
  });

  it("refuses what is not an article", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    await expect(extractArticle("shot.png", png)).rejects.toBeInstanceOf(NotAnArticleError);
    await expect(extractArticle("data.bin", Buffer.from([0, 1, 2, 3]))).rejects.toBeInstanceOf(
      NotAnArticleError,
    );
    await expect(extractArticle("empty.md", Buffer.alloc(0))).rejects.toBeInstanceOf(NotAnArticleError);
  });
});

describe("HTML files", () => {
  const page = `<!DOCTYPE html>
<html><head><title>Reset a VPN token</title></head>
<body><nav><a href="#a">Contents</a></nav><main><h1>Reset a VPN token</h1>
<ol><li>Open the portal.</li><li>Choose <strong>Reset</strong>.</li></ol></main></body></html>`;

  it("becomes a Markdown article, titled by the page", async () => {
    const article = await extractArticle("Remote/VPN/reset.html", md(page));
    expect(article.sourceType).toBe("html");
    expect(article.format).toBe("markdown");
    expect(article.title).toBe("Reset a VPN token");
    expect(article.body).toMatch(/^1\.\s+Open the portal\.$/m);
    expect(article.body).toContain("**Reset**");
    expect(article.category).toBe("Remote");
    expect(article.subcategory).toBe("VPN");
  });

  it("goes by the bytes: a file named .html that is not a page is passed over", async () => {
    await expect(extractArticle("notes.html", md("just some words"))).rejects.toBeInstanceOf(NotAnArticleError);
    await expect(extractArticle("drawing.htm", Buffer.from([0x50, 0x4b, 3, 4, 0, 0]))).rejects.toBeInstanceOf(
      NotAnArticleError,
    );
  });

  it("knows a page by how it starts", () => {
    expect(looksLikeHtml(md("\uFEFF<!doctype html><p>x</p>"))).toBe(true);
    expect(looksLikeHtml(md("<!-- exported -->\n<html lang=en>"))).toBe(true);
    expect(looksLikeHtml(md("<p>no document around it</p>"))).toBe(false);
    expect(looksLikeHtml(md("# Markdown"))).toBe(false);
  });
});

describe("categoryFromPath", () => {
  it("passes over a folder that only names the pile", () => {
    expect(categoryFromPath("articles/Wireless/Access Points/a.md")).toEqual({
      category: "Wireless",
      subcategory: "Access Points",
    });
  });

  it("has nothing to say about a file at the top", () => {
    expect(categoryFromPath("a.md")).toEqual({ category: null, subcategory: null });
  });
});

describe("safeUrl", () => {
  it("keeps web addresses only", () => {
    expect(safeUrl("https://kb.example.com/1")).toBe("https://kb.example.com/1");
    expect(safeUrl("file:///etc/passwd")).toBeNull();
    expect(safeUrl("not a url")).toBeNull();
    expect(safeUrl(null)).toBeNull();
  });
});
