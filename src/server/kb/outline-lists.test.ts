import { describe, expect, it } from "vitest";
import { listMarker, normalizeOutlines } from "./outline-lists";
import { deriveRunbook } from "./runbook";
import { renderArticleMarkdown } from "@/server/fields/render";

const compact = (html: string) => html.replace(/\n/g, "");

describe("normalizeOutlines", () => {
  it("nests lettered items under a numbered one, indented past its marker", () => {
    expect(normalizeOutlines("7. Skip to Email fields:\n  a. Email address\n  b. SMTP Server IP\n8. Save")).toBe(
      "7. Skip to Email fields:\n   <!--ol-type:lower-alpha-->\n   1. Email address\n   2. SMTP Server IP\n8. Save",
    );
  });

  it("reads i. ii. iii. under a lettered item as numerals, and goes back up a level", () => {
    const text = "a. Pick Location\n  i. Select Role(s)\n  ii. Check Default Location (if required)\n  iii. Department\nb. Repeat as needed\nc. Save";
    expect(normalizeOutlines(text)).toBe(
      [
        "<!--ol-type:lower-alpha-->",
        "1. Pick Location",
        "   <!--ol-type:lower-roman-->",
        "   1. Select Role(s)",
        "   2. Check Default Location (if required)",
        "   3. Department",
        "2. Repeat as needed",
        "3. Save",
      ].join("\n"),
    );
  });

  it("counts i as a letter when it follows h", () => {
    const letters = "abcdefghij".split("").map((letter) => `${letter}. Item ${letter}`).join("\n");
    const out = normalizeOutlines(letters);
    expect(out.match(/<!--ol-type:[a-z-]+-->/g)).toEqual(["<!--ol-type:lower-alpha-->"]);
    expect(out).toContain("9. Item i\n10. Item j");
  });

  it("leaves lists of numbers and bullets, prose, and code exactly as written", () => {
    for (const text of [
      "1. One\n  - two\n2. Three",
      "- Pick Location\n  - Select Role(s)",
      "A. Lincoln wrote it.\nAnd more.",
      "Call me at 5 p.m. today.",
      "```\na. not a list\nb. still code\n```",
    ]) {
      expect(normalizeOutlines(text)).toBe(text);
    }
  });

  it("keeps text that goes on under an item with that item", () => {
    expect(normalizeOutlines("a. First\n   more about it\nb. Second")).toBe(
      "<!--ol-type:lower-alpha-->\n1. First\n   more about it\n2. Second",
    );
  });

  it("starts the list on a line of its own after a paragraph", () => {
    expect(normalizeOutlines("Fields:\na. One\nb. Two")).toBe("Fields:\n\n<!--ol-type:lower-alpha-->\n1. One\n2. Two");
  });

  it("handles capitals: A. B. and I. II.", () => {
    expect(normalizeOutlines("A. One\n  I. Sub\n  II. Sub")).toContain("<!--ol-type:upper-alpha-->");
    expect(normalizeOutlines("A. One\n  I. Sub\n  II. Sub")).toContain("<!--ol-type:upper-roman-->");
  });
});

describe("renderArticleMarkdown", () => {
  it("draws a runbook step's lettered note as a nested list numbered a, b and i, ii", () => {
    const body = [
      "7. Skip to Email fields: {#96d2bc97}",
      "  a. Email address: user's MOT email address",
      "  b. SMTP Server IP: `send.smtp.com`",
      "  c. SMTP Server Port: `587`",
      "8. Save (_next to tabs_) {#fe327e57}",
      "9. User Locations {#2d29f64d}",
      "  a. Pick Location",
      "    i. Select Role(s)",
      "    ii. Check Default Location (if required)",
      "    iii. Department",
      "  b. Repeat as needed",
      "  c. Save",
      "10. Complete Employee Info {#f65a570a}",
    ].join("\n");
    const { steps } = deriveRunbook(body);
    expect(steps.map((step) => step.text)).toEqual([
      "Skip to Email fields:",
      "Save (_next to tabs_)",
      "User Locations",
      "Complete Employee Info",
    ]);
    expect(compact(renderArticleMarkdown(steps[0]!.note!))).toBe(
      '<ol data-list="lower-alpha"><li>Email address: user\'s MOT email address</li><li>SMTP Server IP: <code>send.smtp.com</code></li><li>SMTP Server Port: <code>587</code></li></ol>',
    );
    expect(compact(renderArticleMarkdown(steps[2]!.note!))).toBe(
      '<ol data-list="lower-alpha"><li>Pick Location<ol data-list="lower-roman"><li>Select Role(s)</li><li>Check Default Location (if required)</li><li>Department</li></ol></li><li>Repeat as needed</li><li>Save</li></ol>',
    );
  });

  it("takes 3 and 6 spaces as well as 2 and 4", () => {
    const { steps } = deriveRunbook("1. Item #1\n   a. item a\n   b. item b\n      i. item i\n      ii. item ii\n2. Item #2");
    expect(compact(renderArticleMarkdown(steps[0]!.note!))).toBe(
      '<ol data-list="lower-alpha"><li>item a</li><li>item b<ol data-list="lower-roman"><li>item i</li><li>item ii</li></ol></li></ol>',
    );
  });

  it("nests dashes 2 spaces deeper per level, as it always has", () => {
    const { steps } = deriveRunbook("1. Item #1\n  - Sublist item\n    - Second order\n2. Item #2");
    expect(compact(renderArticleMarkdown(steps[0]!.note!))).toBe(
      "<ul><li>Sublist item<ul><li>Second order</li></ul></li></ul>",
    );
  });

  it("does the same in an article's body, under a numbered list", () => {
    expect(compact(renderArticleMarkdown("1. Open it\n  a. Carefully\n  b. Slowly\n2. Close it"))).toBe(
      '<ol><li>Open it<ol data-list="lower-alpha"><li>Carefully</li><li>Slowly</li></ol></li><li>Close it</li></ol>',
    );
  });
});

describe("listMarker", () => {
  it("numbers items the way the list was written", () => {
    expect([1, 2, 26, 27].map((value) => listMarker("lower-alpha", value))).toEqual(["a", "b", "z", "aa"]);
    expect([1, 4, 9, 14, 40].map((value) => listMarker("lower-roman", value))).toEqual(["i", "iv", "ix", "xiv", "xl"]);
    expect(listMarker("upper-roman", 3)).toBe("III");
    expect(listMarker("decimal", 7)).toBe("7");
  });
});
