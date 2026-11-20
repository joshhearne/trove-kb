"use client";

import { createContext, useContext } from "react";
import { DEFAULT_EDITOR_VIEW, type EditorView } from "@/lib/editor-view";

/** How this person's Markdown editors open, from their menu. */
const EditorViewContext = createContext<EditorView>(DEFAULT_EDITOR_VIEW);

export function EditorViewProvider({ view, children }: { view: EditorView; children: React.ReactNode }) {
  return <EditorViewContext.Provider value={view}>{children}</EditorViewContext.Provider>;
}

export function useEditorView(): EditorView {
  return useContext(EditorViewContext);
}
