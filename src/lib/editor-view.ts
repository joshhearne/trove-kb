/**
 * How a Markdown editor opens for a person, chosen in their menu:
 * "visual" with the formatting toolbar (where the field has a visual view),
 * "markdown" as source with its own toolbar, or "split" as source with a
 * live preview beside it. Split needs a wide screen; on a narrow one the
 * editor opens as Markdown instead.
 */
export const EDITOR_VIEWS = ["visual", "markdown", "split"] as const;

export type EditorView = (typeof EDITOR_VIEWS)[number];

export const DEFAULT_EDITOR_VIEW: EditorView = "visual";

export function isEditorView(value: unknown): value is EditorView {
  return typeof value === "string" && (EDITOR_VIEWS as readonly string[]).includes(value);
}
