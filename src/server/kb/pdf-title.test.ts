import { describe, expect, it } from "vitest";
import { titleFromFirstPage, titleFromPdfInfo, type PageTextItem } from "./pdf-title";

/** One text item per line, top of the page first. */
function page(lines: [text: string, size: number][]): PageTextItem[] {
  return lines.map(([str, fontSize], index) => ({ str, fontSize, y: 750 - index * 24, hasEOL: true }));
}

const BODY = 11;
const paragraph: [string, number][] = [
  ["Remote staff connect through the firewall's SSL-VPN on port 10443.", BODY],
  ["Install FortiClient, add the gateway, and sign in with your directory account.", BODY],
  ["If the tunnel drops, check the client's log before restarting anything.", BODY],
];

describe("titleFromFirstPage", () => {
  it("takes the line set larger than the body text", () => {
    expect(titleFromFirstPage(page([["Set up SSL-VPN for remote staff", 24], ...paragraph]))).toBe(
      "Set up SSL-VPN for remote staff",
    );
  });

  it("passes over a smaller header above the title", () => {
    expect(
      titleFromFirstPage(
        page([["Northwind Dental Group · IT", 9], ["Printer setup", 20], ...paragraph]),
      ),
    ).toBe("Printer setup");
  });

  it("joins a title that wraps onto a second line", () => {
    expect(
      titleFromFirstPage(
        page([["Synology Hyper Backup to an", 22], ["offsite target", 22], ...paragraph]),
      ),
    ).toBe("Synology Hyper Backup to an offsite target");
  });

  it("joins items that share a baseline into one line", () => {
    const items: PageTextItem[] = [
      { str: "Adopt an", y: 750, fontSize: 20, hasEOL: false },
      { str: " ", y: 750, fontSize: 20, hasEOL: false },
      { str: "access point", y: 750, fontSize: 20, hasEOL: false },
      ...page(paragraph).map((item) => ({ ...item, y: item.y - 40 })),
    ];
    expect(titleFromFirstPage(items)).toBe("Adopt an access point");
  });

  it("finds no title when nothing stands out", () => {
    expect(titleFromFirstPage(page(paragraph))).toBeNull();
    expect(titleFromFirstPage(page([["Only one line", 20]]))).toBeNull();
  });

  it("ignores large text with no words, such as a page number", () => {
    expect(titleFromFirstPage(page([["01", 40], ...paragraph]))).toBeNull();
  });

  it("clips a very long title at a word", () => {
    const long = "Firewall ".repeat(40).trim();
    const title = titleFromFirstPage(page([[long, 24], ...paragraph, ...paragraph, ...paragraph]));
    expect(title!.length).toBeLessThanOrEqual(201);
    expect(title!.endsWith("Firewall…")).toBe(true);
  });
});

describe("titleFromPdfInfo", () => {
  it("uses a Title the author set", () => {
    expect(titleFromPdfInfo({ Title: "  UniFi:  adopt an access point " }, "guides/ap.pdf")).toBe(
      "UniFi: adopt an access point",
    );
  });

  it("passes over placeholders and file names", () => {
    for (const Title of [
      "Untitled",
      "Document1",
      "Microsoft Word - VPN guide.docx",
      "VPN_guide.pdf",
      "vpn guide",
      "12345",
      "",
    ]) {
      expect(titleFromPdfInfo({ Title }, "imports/vpn-guide.pdf")).toBeNull();
    }
  });

  it("finds nothing when there is no Title", () => {
    expect(titleFromPdfInfo({}, "a.pdf")).toBeNull();
    expect(titleFromPdfInfo(undefined, "a.pdf")).toBeNull();
  });
});
