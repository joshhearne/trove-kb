"use client";

import { createContext, useContext } from "react";
import type { WikilinkContext } from "@/server/services/wikilinks";

/**
 * Where the page being edited sits, for every Markdown editor on it: its
 * [[ links are suggested from there, and flagged where some of its readers
 * could not follow them. Absent, editors offer no links.
 */
const LinkContext = createContext<WikilinkContext | null>(null);

export function WikilinkProvider({ value, children }: { value: WikilinkContext; children: React.ReactNode }) {
  return <LinkContext.Provider value={value}>{children}</LinkContext.Provider>;
}

export function useWikilinkContext(): WikilinkContext | null {
  return useContext(LinkContext);
}
