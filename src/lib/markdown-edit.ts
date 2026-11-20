/**
 * What the Markdown toolbar and its keys do to the text: each takes the text
 * and the selection and gives back both, changed. Kept apart from the
 * component so every edit can be tested without a browser.
 */

export type EditState = { value: string; start: number; end: number };

/** A list item's marker: `-`, `*`, `+`, `1.`, `a.`, `ii)`. */
const LIST_ITEM = /^( *)([-*+]|(?:\d{1,9}|[A-Za-z]{1,6})[.)])( +)/;

type LineRange = { from: number; to: number; first: number; last: number; lines: string[] };

/** The whole lines the selection touches. */
function selectedLines(state: EditState): LineRange {
  const from = state.value.lastIndexOf("\n", state.start - 1) + 1;
  // A selection ending at the start of a line does not take that line in.
  const endAt = state.end > state.start && state.value[state.end - 1] === "\n" ? state.end - 1 : state.end;
  const next = state.value.indexOf("\n", endAt);
  const to = next === -1 ? state.value.length : next;
  const lines = state.value.slice(from, to).split("\n");
  const first = state.value.slice(0, from).split("\n").length - 1;
  return { from, to, first, last: first + lines.length - 1, lines };
}

/** Replaces the touched lines, keeping the selection on the same text where it can. */
function replaceLines(state: EditState, range: LineRange, lines: string[]): EditState {
  const text = lines.join("\n");
  const value = state.value.slice(0, range.from) + text + state.value.slice(range.to);
  const firstDelta = (lines[0]?.length ?? 0) - (range.lines[0]?.length ?? 0);
  const totalDelta = text.length - (range.to - range.from);
  if (state.start === state.end) {
    const start = Math.max(range.from, state.start + firstDelta);
    return { value, start, end: start };
  }
  return { value, start: Math.max(range.from, state.start + firstDelta), end: Math.max(range.from, state.end + totalDelta) };
}

/* ---------- Bold, italic, code: around the selection ---------- */

/** Wraps the selection in a marker, or takes the marker off when it is already there. */
export function toggleWrap(state: EditState, marker: string, placeholder = ""): EditState {
  const { value, start, end } = state;
  const before = value.slice(start - marker.length, start);
  const after = value.slice(end, end + marker.length);
  if (before === marker && after === marker) {
    return {
      value: value.slice(0, start - marker.length) + value.slice(start, end) + value.slice(end + marker.length),
      start: start - marker.length,
      end: end - marker.length,
    };
  }
  const selected = value.slice(start, end);
  if (selected.startsWith(marker) && selected.endsWith(marker) && selected.length >= marker.length * 2) {
    const inner = selected.slice(marker.length, selected.length - marker.length);
    return { value: value.slice(0, start) + inner + value.slice(end), start, end: start + inner.length };
  }
  const text = selected || placeholder;
  return {
    value: value.slice(0, start) + marker + text + marker + value.slice(end),
    start: start + marker.length,
    end: start + marker.length + text.length,
  };
}

/** A link around the selection, with the address selected for typing. */
export function insertLink(state: EditState, placeholder: string): EditState {
  const { value, start, end } = state;
  const text = value.slice(start, end) || placeholder;
  const inserted = `[${text}](https://)`;
  const urlStart = start + text.length + 3;
  return { value: value.slice(0, start) + inserted + value.slice(end), start: urlStart, end: urlStart + "https://".length };
}

/* ---------- Headings, quotes, lists: at the start of each line ---------- */

export type LinePrefix = "heading" | "quote" | "bullet" | "numbered";

const PREFIX_PATTERN: Record<LinePrefix, RegExp> = {
  heading: /^#{1,6} +/,
  quote: /^> ?/,
  bullet: /^( *)[-*+] +/,
  numbered: /^( *)\d{1,9}[.)] +/,
};

/**
 * Starts each selected line as a heading, quote, bullet or numbered item, or
 * takes that off when every line already has it. Numbers count up from 1.
 */
export function toggleLinePrefix(state: EditState, kind: LinePrefix): EditState {
  const range = selectedLines(state);
  const pattern = PREFIX_PATTERN[kind];
  const content = range.lines.filter((line) => line.trim() !== "");
  const all = content.length > 0 && content.every((line) => pattern.test(line));
  let number = 0;
  const lines = range.lines.map((line) => {
    if (line.trim() === "" && range.lines.length > 1) return line;
    if (all) return line.replace(pattern, (_match, indent?: string) => indent ?? "");
    const indent = /^ */.exec(line)?.[0] ?? "";
    // Whatever marker the line had gives way to the new one.
    const bare = line.slice(indent.length).replace(/^(?:#{1,6} +|> ?|[-*+] +|\d{1,9}[.)] +)/, "");
    switch (kind) {
      case "heading":
        return `## ${bare}`;
      case "quote":
        return `> ${bare}`;
      case "bullet":
        return `${indent}- ${bare}`;
      case "numbered":
        number += 1;
        return `${indent}${number}. ${bare}`;
    }
  });
  return replaceLines(state, range, lines);
}

/* ---------- Indent and outdent ---------- */

function indentOf(line: string): number {
  return /^ */.exec(line)?.[0].length ?? 0;
}

/** The column an item's own text starts at: past "1. ", "- ", "a. ". */
function contentColumn(line: string): number | null {
  const match = LIST_ITEM.exec(line);
  return match ? match[1]!.length + match[2]!.length + match[3]!.length : null;
}

export function isListItem(line: string): boolean {
  return LIST_ITEM.test(line);
}

/** The nearest list item above `index` indented no deeper than `most`, within the same block. */
function itemAbove(lines: string[], index: number, most: number, strictlyLess: boolean): string | null {
  for (let at = index - 1; at >= 0; at -= 1) {
    const line = lines[at]!;
    if (line.trim() === "") {
      // A blank line followed by text at the margin ends the block.
      const next = lines[at + 1] ?? "";
      if (indentOf(next) === 0 && !isListItem(next)) return null;
      continue;
    }
    const indent = indentOf(line);
    if (isListItem(line) && (strictlyLess ? indent < most : indent <= most)) return line;
    if (indent === 0 && !isListItem(line)) return null;
  }
  return null;
}

/**
 * Indents each selected line one level: under the item above, past its
 * marker, which is how far Markdown needs a line moved to nest it — 3 spaces
 * under "1.", 2 under "-". A line already nested goes 2 spaces further.
 */
export function indentLines(state: EditState): EditState {
  const all = state.value.split("\n");
  const range = selectedLines(state);
  const lines = range.lines.map((line, offset) => {
    if (line.trim() === "") return line;
    const index = range.first + offset;
    const current = indentOf(line);
    const parent = itemAbove(all, index, current, false);
    const column = parent ? contentColumn(parent) : null;
    const target = column !== null && column > current ? column : current + 2;
    const next = " ".repeat(target) + line.slice(current);
    all[index] = next;
    return next;
  });
  return replaceLines(state, range, lines);
}

/** Outdents each selected line one level: back to where the item it sits under starts. */
export function outdentLines(state: EditState): EditState {
  const all = state.value.split("\n");
  const range = selectedLines(state);
  const lines = range.lines.map((line, offset) => {
    const current = indentOf(line);
    if (line.trim() === "" || current === 0) return line;
    const index = range.first + offset;
    const parent = itemAbove(all, index, current, true);
    const target = parent ? indentOf(parent) : Math.max(0, current - 2);
    const next = " ".repeat(target) + line.slice(current);
    all[index] = next;
    return next;
  });
  return replaceLines(state, range, lines);
}

/** Whether Tab should indent here rather than move on: in a list item, or across several lines. */
export function tabIndents(state: EditState): boolean {
  const range = selectedLines(state);
  return range.lines.length > 1 || range.lines.some(isListItem);
}
