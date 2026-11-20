/**
 * Outlines written the way people write them by hand or in Word: lettered
 * and roman-numeral sub-items under a numbered step, indented by however
 * many spaces the author used.
 *
 *     7. Skip to Email fields:
 *       a. Email address
 *       b. SMTP Server IP
 *     9. User Locations
 *       a. Pick Location
 *         i. Select Role(s)
 *         ii. Department
 *       b. Repeat as needed
 *
 * Markdown knows only numbers and bullets, and nests a list only when it is
 * indented past its parent's marker, so as written this reads as one run-on
 * paragraph. `normalizeOutlines` rewrites such a list as standard Markdown,
 * each level indented under the item above it, and marks each lettered or
 * roman level with a comment (`<!--ol-type:lower-alpha-->`) so whatever draws
 * it can number it a, b, c or i, ii, iii again: `withListTypes` for HTML, the
 * PDF export for its own lists.
 *
 * A list with no lettered or roman level is left exactly as written, so
 * nothing that renders correctly today changes.
 */

export type ListType = "decimal" | "bullet" | "lower-alpha" | "upper-alpha" | "lower-roman" | "upper-roman";

const MARKER = /^( *)(\d{1,9}|[A-Za-z]{1,6})([.)]) +(.*)$/;
const BULLET = /^( *)([-*+]) +(.*)$/;
const TYPE_COMMENT = /<!--ol-type:(lower-alpha|upper-alpha|lower-roman|upper-roman)-->/;

function romanValue(text: string): number | null {
  const values: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100 };
  const lower = text.toLowerCase();
  if (!/^[ivxlc]+$/.test(lower)) return null;
  let total = 0;
  for (let at = 0; at < lower.length; at += 1) {
    const value = values[lower[at]!]!;
    const next = values[lower[at + 1] ?? ""] ?? 0;
    total += value < next ? -value : value;
  }
  return total > 0 ? total : null;
}

function letterValue(text: string): number {
  return text.toLowerCase().charCodeAt(0) - 96;
}

/**
 * What a marker could be, given the list it would join. A level starts with
 * a, A, i or I; once started, "i" after "h" is a letter and "ii" a numeral.
 */
function classify(token: string, level: ListType | null): { kind: ListType; value: number } | null {
  if (/^\d+$/.test(token)) return { kind: "decimal", value: Number(token) };
  const upper = token === token.toUpperCase();
  if (level === "lower-alpha" || level === "upper-alpha") {
    if (token.length === 1 && upper === (level === "upper-alpha")) return { kind: level, value: letterValue(token) };
  }
  if (level === "lower-roman" || level === "upper-roman") {
    const value = romanValue(token);
    if (value !== null && upper === (level === "upper-roman")) return { kind: level, value };
  }
  if (level === null) {
    if (token === "a" || token === "A") return { kind: upper ? "upper-alpha" : "lower-alpha", value: 1 };
    if (token === "i" || token === "I") return { kind: upper ? "upper-roman" : "lower-roman", value: 1 };
  }
  return null;
}

type Item = { kind: ListType; value: number; bullet: string; text: string[]; children: Level[] };
type Level = { indent: number; kind: ListType; items: Item[]; nested: boolean };

/** Expands leading tabs, so indentation can be compared. */
function expand(line: string): string {
  const match = /^[ \t]*/.exec(line)?.[0] ?? "";
  return match.includes("\t") ? match.replace(/\t/g, "    ") + line.slice(match.length) : line;
}

/** Builds the levels of one block of list lines, by how far each line is indented. */
function parse(lines: string[]): { levels: Level[]; outlined: boolean } {
  const root: Level[] = [];
  const stack: Level[] = [];
  let blankBefore = false;
  let last: Item | null = null;

  for (const raw of lines) {
    if (raw.trim() === "") {
      blankBefore = true;
      continue;
    }
    const indent = /^ */.exec(raw)?.[0].length ?? 0;
    const bullet = BULLET.exec(raw);
    const ordered = bullet ? null : MARKER.exec(raw);

    // Which level this line would join: the deepest one not indented past it.
    while (stack.length > 0 && stack[stack.length - 1]!.indent > indent) stack.pop();
    const top = stack[stack.length - 1];
    const sameLevel = top && top.indent === indent ? top : null;

    let marker: { kind: ListType; value: number; bullet: string; text: string } | null = null;
    if (bullet) marker = { kind: "bullet", value: 0, bullet: bullet[2]!, text: bullet[3]! };
    else if (ordered) {
      const found = classify(ordered[2]!, sameLevel ? sameLevel.kind : null);
      if (found) marker = { ...found, bullet: "", text: ordered[4]! };
    }

    if (!marker) {
      // Text that goes on from the item above.
      if (last) {
        if (blankBefore) last.text.push("");
        last.text.push(raw.trim());
      }
      blankBefore = false;
      continue;
    }
    let level = sameLevel;
    if (!level || (level.kind !== marker.kind && (level.kind === "bullet") !== (marker.kind === "bullet"))) {
      const parent = top && top.indent < indent ? top.items[top.items.length - 1] : undefined;
      level = { indent, kind: marker.kind, items: [], nested: !!parent };
      if (parent) parent.children.push(level);
      else if (sameLevel) {
        // A bullet list right after a numbered one at the same depth: a list of its own.
        const owner = stack[stack.length - 2]?.items.at(-1);
        (owner ? owner.children : root).push(level);
        stack.pop();
      } else root.push(level);
      stack.push(level);
    }
    if (blankBefore && last) last.text.push("");
    last = { kind: marker.kind, value: marker.value, bullet: marker.bullet, text: [marker.text], children: [] };
    level.items.push(last);
    blankBefore = false;
  }
  return { levels: root, outlined: root.some(isOutline) };
}

/**
 * Whether a lettered or roman level is really an outline: one under an item,
 * or two items or more. A lone "A. Lincoln wrote it." stays a sentence.
 */
function isOutline(level: Level): boolean {
  const lettered = level.kind !== "decimal" && level.kind !== "bullet";
  if (lettered && (level.nested || level.items.length > 1)) return true;
  return level.items.some((item) => item.children.some(isOutline));
}

function emit(levels: Level[], pad: string, out: string[]): void {
  for (const level of levels) {
    if (level.kind !== "decimal" && level.kind !== "bullet") out.push(`${pad}<!--ol-type:${level.kind}-->`);
    for (const [index, item] of level.items.entries()) {
      // A numbered level keeps its own numbers; a lettered one counts from 1 under its comment.
      const marker =
        level.kind === "bullet" ? item.bullet || "-" : `${level.kind === "decimal" ? item.value : index + 1}.`;
      const inner = pad + " ".repeat(marker.length + 1);
      const [first, ...rest] = item.text;
      out.push(`${pad}${marker} ${first ?? ""}`);
      for (const line of rest) out.push(line === "" ? "" : `${inner}${line}`);
      emit(item.children, inner, out);
    }
  }
}

/** Lines inside fenced code, which are never lists. */
function fencedLines(lines: string[]): boolean[] {
  const inside: boolean[] = [];
  let fence: string | null = null;
  for (const line of lines) {
    const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      inside.push(true);
      if (match && match[1]![0] === fence[0] && match[1]!.length >= fence.length) fence = null;
    } else if (match) {
      inside.push(true);
      fence = match[1]!;
    } else inside.push(false);
  }
  return inside;
}

function isListLine(line: string): boolean {
  return BULLET.test(line) || MARKER.test(line);
}

/** The Markdown with every hand-written outline rewritten as nested Markdown lists. */
export function normalizeOutlines(markdown: string): string {
  if (!/^[ \t]*(?:[A-Za-z]{1,6})[.)] /m.test(markdown)) return markdown;
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n").map(expand);
  const inside = fencedLines(lines);
  const out: string[] = [];

  let at = 0;
  while (at < lines.length) {
    if (inside[at] || !isListLine(lines[at]!)) {
      out.push(lines[at]!);
      at += 1;
      continue;
    }
    // One block: list lines, lines indented under them, and blank lines
    // between them when the list carries on after.
    const start = at;
    at += 1;
    while (at < lines.length && !inside[at]) {
      const line = lines[at]!;
      if (line.trim() === "") {
        let peek = at;
        while (peek < lines.length && lines[peek]!.trim() === "") peek += 1;
        const next = lines[peek];
        if (next === undefined || inside[peek] || !(isListLine(next) || /^ {2,}/.test(next))) break;
        at = peek;
        continue;
      }
      if (!(isListLine(line) || /^ {2,}/.test(line))) break;
      at += 1;
    }
    const block = lines.slice(start, at);
    const { levels, outlined } = parse(block);
    if (!outlined) {
      out.push(...block);
      continue;
    }
    // A list straight after a paragraph needs a blank line to begin.
    if (out.length > 0 && out[out.length - 1]!.trim() !== "") out.push("");
    emit(levels, "", out);
  }
  return out.join("\n");
}

/** HTML from normalized Markdown, with each marked list numbered as written: a, b, c or i, ii, iii. */
export function withListTypes(html: string): string {
  return html.replace(
    /<!--ol-type:(lower-alpha|upper-alpha|lower-roman|upper-roman)-->\s*<ol/g,
    '<ol data-list="$1"',
  );
}

/** The list type an HTML comment from `normalizeOutlines` names, for a renderer that reads tokens. */
export function listTypeOf(html: string): ListType | null {
  return (TYPE_COMMENT.exec(html)?.[1] as ListType | undefined) ?? null;
}

const ROMAN: [number, string][] = [
  [100, "c"],
  [90, "xc"],
  [50, "l"],
  [40, "xl"],
  [10, "x"],
  [9, "ix"],
  [5, "v"],
  [4, "iv"],
  [1, "i"],
];

/** How an item of a list of this type is numbered: 3 → "c", "iii", "C" or "III". */
export function listMarker(type: ListType, value: number): string {
  if (type === "lower-alpha" || type === "upper-alpha") {
    let text = "";
    for (let left = value; left > 0; left = Math.floor((left - 1) / 26)) text = String.fromCharCode(97 + ((left - 1) % 26)) + text;
    return type === "upper-alpha" ? text.toUpperCase() : text;
  }
  if (type === "lower-roman" || type === "upper-roman") {
    let text = "";
    let left = value;
    for (const [amount, numeral] of ROMAN) {
      while (left >= amount) {
        text += numeral;
        left -= amount;
      }
    }
    return type === "upper-roman" ? text.toUpperCase() : text;
  }
  return String(value);
}
