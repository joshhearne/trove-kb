import { describe, expect, it } from "vitest";
import {
  applyWikilinks,
  formatWikilink,
  openWikilinkAt,
  parseWikilinks,
  wikilinkLabels,
  wikilinksToMarkdown,
  wikilinkTargets,
  type WikilinkIndex,
} from "./wikilinks";

const DOC = "3f9a0c1e-3a5d-4c7b-9e2f-1a2b3c4d5e6f";
const KB = "8c21aa00-1111-4222-8333-944455566677";

describe("parseWikilinks", () => {
  it("reads links by id, with and without a label, and links that only name a page", () => {
    const text = `See [[doc:${DOC}|Server room switch]], [[kb:${KB}]] and [[Firewall rules]].`;
    expect(parseWikilinks(text).map(({ kind, id, label }) => ({ kind, id, label }))).toEqual([
      { kind: "doc", id: DOC, label: "Server room switch" },
      { kind: "kb", id: KB, label: "" },
      { kind: null, id: null, label: "Firewall rules" },
    ]);
  });

  it("ignores links inside code", () => {
    expect(parseWikilinks("`[[Not a link]]`\n\n```\n[[Nor this]]\n```\n[[This]]").map((link) => link.label)).toEqual(["This"]);
  });

  it("lists each page once", () => {
    expect(wikilinkTargets(`[[doc:${DOC}|A]] [[doc:${DOC.toUpperCase()}|B]] [[kb:${KB}]]`)).toEqual([
      { kind: "doc", id: DOC },
      { kind: "kb", id: KB },
    ]);
  });
});

describe("applyWikilinks", () => {
  const index: WikilinkIndex = new Map([
    [`doc:${DOC}`, { href: `/documents/${DOC}`, title: "Core switch" }],
    [`kb:${KB}`, { href: null, title: "Secret article" }],
  ]);

  it("links a page the reader may open, with the author's label or its title now", () => {
    expect(applyWikilinks(`Go to [[doc:${DOC}|the switch]].`, index)).toBe(`Go to [the switch](/documents/${DOC}).`);
    expect(applyWikilinks(`[[doc:${DOC}]]`, index)).toBe(`[Core switch](/documents/${DOC})`);
  });

  it("writes the label alone for a page the reader may not open, never its title", () => {
    expect(applyWikilinks(`[[kb:${KB}|Steps]]`, index)).toBe('<span class="wikilink wikilink-missing">Steps</span>');
    expect(applyWikilinks(`[[kb:${KB}]]`, index)).not.toContain("Secret article");
  });

  it("links nothing when nobody resolved the links", () => {
    expect(applyWikilinks(`[[doc:${DOC}|A]]`)).toBe('<span class="wikilink wikilink-missing">A</span>');
  });

  it("marks a link that only names a page, and escapes what it says", () => {
    expect(applyWikilinks("[[<b>New</b> page]]")).toBe('<span class="wikilink wikilink-unmade">&lt;b&gt;New&lt;/b&gt; page</span>');
  });

  it("keeps a label's brackets from ending the link early", () => {
    expect(applyWikilinks(`[[doc:${DOC}|Switch [core]]]`, index)).toContain("[Switch \\[core");
  });
});

describe("wikilinkLabels", () => {
  it("leaves the labels as plain text", () => {
    expect(wikilinkLabels(`See [[doc:${DOC}|the switch]] and [[Firewall]].`)).toBe("See the switch and Firewall.");
  });
});

describe("formatWikilink", () => {
  it("writes the id first and a clean label", () => {
    expect(formatWikilink("doc", DOC, "Switch | core]")).toBe(`[[doc:${DOC}|Switch core]]`);
  });
});

describe("openWikilinkAt", () => {
  it("finds the link being typed and what was typed so far", () => {
    const value = "See [[serv]] now";
    expect(openWikilinkAt(value, 10)).toEqual({ from: 4, to: 12, query: "serv" });
    expect(openWikilinkAt("See [[", 6)).toEqual({ from: 4, to: 6, query: "" });
  });

  it("is not inside a finished link, a link by id, or across lines", () => {
    expect(openWikilinkAt("[[a]] b", 7)).toBeNull();
    expect(openWikilinkAt(`[[doc:${DOC}`, 10)).toBeNull();
    expect(openWikilinkAt("[[a\nb", 5)).toBeNull();
  });
});

describe("wikilinksToMarkdown", () => {
  it("writes ordinary links where the reader may open the page, and the label elsewhere", () => {
    const index: WikilinkIndex = new Map([[`doc:${DOC}`, { href: `https://kb.example.com/documents/${DOC}`, title: "Core" }]]);
    expect(wikilinksToMarkdown(`[[doc:${DOC}|Switch]] and [[kb:${KB}|Hidden]]`, index)).toBe(
      `[Switch](https://kb.example.com/documents/${DOC}) and Hidden`,
    );
  });
});
