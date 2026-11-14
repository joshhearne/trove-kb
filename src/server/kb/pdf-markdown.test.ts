import { describe, expect, it } from "vitest";
import { pdfPagesToMarkdown } from "./pdf-markdown";
import type { PageTextItem } from "./pdf-title";

type Row = [text: string, size?: number, gapBefore?: number];

/** A page drawn top to bottom: each row one line, 11pt unless sized, 14pt apart unless spaced. */
function page(rows: Row[]): PageTextItem[] {
  let y = 760;
  return rows.map(([str, fontSize = 11, gap = 14], index) => {
    if (index > 0) y -= gap;
    return { str, fontSize, y, hasEOL: true };
  });
}

describe("pdfPagesToMarkdown", () => {
  it("turns larger type into headings, by size", () => {
    const md = pdfPagesToMarkdown([
      page([
        ["Set up SSL-VPN", 24],
        ["Remote staff connect through the firewall.", 11, 30],
        ["Before you start", 16, 28],
        ["Have the gateway address ready.", 11, 22],
        ["Client settings", 13, 26],
        ["Use port 10443.", 11, 20],
      ]),
    ]);
    expect(md).toBe(
      [
        "# Set up SSL-VPN",
        "Remote staff connect through the firewall.",
        "## Before you start",
        "Have the gateway address ready.",
        "### Client settings",
        "Use port 10443.",
      ].join("\n\n"),
    );
  });

  it("joins wrapped lines into paragraphs and splits on a wider gap", () => {
    const md = pdfPagesToMarkdown([
      page([
        ["Install the client on each laptop and add", 11],
        ["the gateway under Remote Access.", 11],
        ["If the tunnel drops, check the log first.", 11, 30],
      ]),
    ]);
    expect(md).toBe(
      "Install the client on each laptop and add the gateway under Remote Access.\n\nIf the tunnel drops, check the log first.",
    );
  });

  it("rejoins a word hyphenated across lines", () => {
    expect(pdfPagesToMarkdown([page([["Run the configu-"], ["ration backup nightly."]])])).toBe(
      "Run the configuration backup nightly.",
    );
  });

  it("joins a heading that wraps", () => {
    const md = pdfPagesToMarkdown([
      page([
        ["Synology Hyper Backup to an", 22],
        ["offsite target", 22, 26],
        ["Back up the shares nightly, then copy the newest version offsite every Sunday.", 11, 30],
        ["Keep thirty daily versions on the NAS and twelve monthly versions offsite.", 11],
      ]),
    ]);
    expect(md.split("\n\n")[0]).toBe("# Synology Hyper Backup to an offsite target");
  });

  it("keeps bulleted and numbered lists as lists", () => {
    const md = pdfPagesToMarkdown([
      page([
        ["Steps", 16],
        ["1. Open the controller", 11, 26],
        ["2. Adopt the access point,", 11],
        ["then name it after the room", 11],
        ["• Check the firmware", 11, 24],
        ["- Note the MAC address", 11],
      ]),
    ]);
    expect(md).toBe(
      [
        "# Steps",
        "1. Open the controller\n2. Adopt the access point, then name it after the room\n- Check the firmware\n- Note the MAC address",
      ].join("\n\n"),
    );
  });

  it("reads indented lines as list items when the bullets were drawn as shapes", () => {
    // Body text starts at x=64 and runs to 548; item text is indented to 94.
    const at = (str: string, y: number, x: number, width: number, fontSize = 11): PageTextItem => ({
      str, y, x, width, fontSize, hasEOL: true,
    });
    const md = pdfPagesToMarkdown([
      [
        at("Before you start", 700, 64, 100, 13),
        at("An offsite target with enough space for the first full copy plus thirty days of versions.", 670, 94, 405),
        at("Credentials for the target, kept in the vault, never in the task description.", 655, 94, 350),
        at("Choose the destination type: S3 Storage for object storage, Remote NAS device for another", 640, 94, 454),
        at("Synology.", 625, 94, 47),
        at("Hyper Backup copies shared folders and application settings from the NAS to another Synology, an", 595, 64, 484),
        at("rsync server, or S3-compatible object storage.", 580, 64, 190),
      ],
    ]);
    expect(md).toBe(
      [
        "# Before you start",
        [
          "- An offsite target with enough space for the first full copy plus thirty days of versions.",
          "- Credentials for the target, kept in the vault, never in the task description.",
          "- Choose the destination type: S3 Storage for object storage, Remote NAS device for another Synology.",
        ].join("\n"),
        "Hyper Backup copies shared folders and application settings from the NAS to another Synology, an rsync server, or S3-compatible object storage.",
      ].join("\n\n"),
    );
  });

  it("keeps a hyphen when a hyphenated name breaks across lines", () => {
    expect(pdfPagesToMarkdown([page([["Connect through the SSL-"], ["VPN on port 10443."]])])).toBe(
      "Connect through the SSL-VPN on port 10443.",
    );
  });

  it("drops a small running header repeated on both pages of a two-page PDF", () => {
    const pages = [1, 2].map((n) =>
      page([
        [`Body text of page ${n}, which is the content of the guide.`, 11],
        [`More of page ${n}, still the content.`, 11],
        ["Northwind Dental Group · IT handbook", 8, 40],
      ]),
    );
    expect(pdfPagesToMarkdown(pages)).not.toContain("IT handbook");
  });

  it("leaves a dash that isn't a bullet alone", () => {
    expect(pdfPagesToMarkdown([page([["-5 dBm is the floor."]])])).toBe("-5 dBm is the floor.");
  });

  it("drops running headers, footers and page numbers", () => {
    const pages = [1, 2, 3].map((n) =>
      page([
        ["Northwind Dental Group · IT handbook", 9],
        [`Body text of page ${n}, which is the content.`, 11, 30],
        [`Page ${n} of 3`, 9, 40],
      ]),
    );
    expect(pdfPagesToMarkdown(pages)).toBe(
      [1, 2, 3].map((n) => `Body text of page ${n}, which is the content.`).join("\n\n"),
    );
  });

  it("escapes text that would read as Markdown", () => {
    const md = pdfPagesToMarkdown([
      page([["Set *all* ports to <auto> on switch_01 [rack 2]"], ["# is the root prompt", 11, 30], ["3) restart", 11, 30]]),
    ]);
    expect(md).toContain("Set \\*all\\* ports to \\<auto\\> on switch\\_01 \\[rack 2\\]");
    expect(md).toContain("\\# is the root prompt");
  });

  it("keeps a large number out of the headings", () => {
    expect(pdfPagesToMarkdown([page([["99.9%", 30], ["Uptime last quarter, across all sites.", 11, 40]])])).toBe(
      "99.9%\n\nUptime last quarter, across all sites.",
    );
  });

  it("returns nothing for pages with no text", () => {
    expect(pdfPagesToMarkdown([[], []])).toBe("");
  });
});
