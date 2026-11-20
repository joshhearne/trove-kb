import sanitizeHtml from "sanitize-html";

/**
 * Allowlist for `richtext` field values. Everything a document author needs and
 * nothing that executes: no script, style, iframe, form, event handlers, or
 * javascript: URLs. Applied on write, never only on read (see CLAUDE.md).
 */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "hr",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "strong", "b", "em", "i", "u", "s", "code", "pre", "blockquote",
    "ul", "ol", "li",
    "a", "img",
    "table", "thead", "tbody", "tr", "th", "td",
    "span", "div",
    // A checklist item: the box is only ever a disabled checkbox.
    "input", "label",
  ],
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
    img: ["src", "alt", "title", "width", "height"],
    td: ["colspan", "rowspan"],
    th: ["colspan", "rowspan", "scope"],
    input: ["type", "checked", "disabled"],
    ul: ["data-type"],
    // How an outline was numbered: a, b, c or i, ii, iii (src/server/kb/outline-lists.ts).
    ol: ["data-list"],
    li: ["data-type", "data-checked"],
    "*": ["class"],
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowedSchemesByTag: { img: ["http", "https", "data"] },
  allowProtocolRelative: false,
  transformTags: {
    // Outbound links open safely or not at all.
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer nofollow" }),
    // Whatever an input claimed to be, it is a read-only checkbox here.
    input: (tagName, attribs) => ({
      tagName,
      attribs: {
        type: "checkbox",
        disabled: "",
        ...("checked" in attribs ? { checked: "" } : {}),
      },
    }),
  },
  disallowedTagsMode: "discard",
};

export function sanitizeRichText(html: string): string {
  return sanitizeHtml(html, OPTIONS);
}

/** Plain text of an HTML fragment, for the search index. */
export function htmlToText(html: string): string {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
