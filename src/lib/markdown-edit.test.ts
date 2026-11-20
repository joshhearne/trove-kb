import { describe, expect, it } from "vitest";
import {
  indentLines,
  insertLink,
  outdentLines,
  tabIndents,
  toggleLinePrefix,
  toggleWrap,
  type EditState,
} from "./markdown-edit";

/** Text with the selection marked: `[` and `]` around it, or `|` for a caret. */
function at(text: string): EditState {
  const caret = text.indexOf("|");
  if (caret !== -1) return { value: text.replace("|", ""), start: caret, end: caret };
  const start = text.indexOf("[");
  const end = text.indexOf("]") - 1;
  return { value: text.replace("[", "").replace("]", ""), start, end };
}

function show(state: EditState): string {
  const { value, start, end } = state;
  return start === end ? value.slice(0, start) + "|" + value.slice(start) : value.slice(0, start) + "[" + value.slice(start, end) + "]" + value.slice(end);
}

describe("toggleWrap", () => {
  it("wraps the selection, and unwraps it again", () => {
    const bold = toggleWrap(at("Save [now] please"), "**");
    expect(show(bold)).toBe("Save **[now]** please");
    expect(show(toggleWrap(bold, "**"))).toBe("Save [now] please");
  });

  it("puts a placeholder in when nothing is selected", () => {
    expect(show(toggleWrap(at("Use |"), "`", "code"))).toBe("Use `[code]`");
  });
});

describe("insertLink", () => {
  it("links the selection and selects the address", () => {
    const state = insertLink({ value: "See the guide.", start: 4, end: 13 }, "text");
    expect(state.value).toBe("See [the guide](https://).");
    expect(state.value.slice(state.start, state.end)).toBe("https://");
  });
});

describe("toggleLinePrefix", () => {
  it("numbers selected lines from 1, and takes the numbers off again", () => {
    const numbered = toggleLinePrefix(at("[Open it\nClose it]"), "numbered");
    expect(numbered.value).toBe("1. Open it\n2. Close it");
    expect(toggleLinePrefix({ ...numbered, start: 0, end: numbered.value.length }, "numbered").value).toBe("Open it\nClose it");
  });

  it("swaps one marker for another, keeping the indent", () => {
    expect(toggleLinePrefix(at("   1. Item|"), "bullet").value).toBe("   - Item");
  });

  it("makes a heading of the line the caret is on", () => {
    expect(toggleLinePrefix(at("Intro\nSet|up\nMore"), "heading").value).toBe("Intro\n## Setup\nMore");
  });
});

describe("indentLines and outdentLines", () => {
  it("indents an item under the one above, past its marker: 3 spaces under 1., 2 under -", () => {
    expect(indentLines(at("1. Item\n2. Sub|")).value).toBe("1. Item\n   2. Sub");
    expect(indentLines(at("- Item\n- Sub|")).value).toBe("- Item\n  - Sub");
    expect(indentLines(at("1. Item\n   a. One\n   b. Two|")).value).toBe("1. Item\n   a. One\n      b. Two");
  });

  it("goes 2 spaces further when the line is already nested as far as the item above", () => {
    expect(indentLines(at("- Item\n  - Sub|")).value).toBe("- Item\n    - Sub");
  });

  it("outdents back to where the item above it starts", () => {
    expect(outdentLines(at("1. Item\n   a. One\n      i. Deep|")).value).toBe("1. Item\n   a. One\n   i. Deep");
    expect(outdentLines(at("1. Item\n   a. One|")).value).toBe("1. Item\na. One");
    expect(outdentLines(at("Text|")).value).toBe("Text");
  });

  it("moves every selected line, and keeps the selection on them", () => {
    const state = indentLines(at("1. Item\n[2. One\n3. Two]"));
    expect(state.value).toBe("1. Item\n   2. One\n   3. Two");
    expect(state.value.slice(state.start, state.end)).toBe("2. One\n   3. Two");
  });

  it("keeps the caret on the same character", () => {
    expect(show(indentLines(at("- A\n- B|c")))).toBe("- A\n  - B|c");
    expect(show(outdentLines(at("- A\n  - B|c")))).toBe("- A\n- B|c");
  });
});

describe("tabIndents", () => {
  it("indents in a list item or across lines, and lets Tab move on otherwise", () => {
    expect(tabIndents(at("- Item|"))).toBe(true);
    expect(tabIndents(at("a. Item|"))).toBe(true);
    expect(tabIndents(at("[One\nTwo]"))).toBe(true);
    expect(tabIndents(at("Plain text|"))).toBe(false);
  });
});
