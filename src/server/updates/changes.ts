import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseChange, type ChangeEntry } from "@/lib/changes";

export * from "@/lib/changes";

/** Where the change files sit next to the running server. */
export function changesDir(): string {
  return process.env.TROVE_CHANGES_DIR || join(process.cwd(), "changes");
}

/** Every usable change file in a directory, by file name. None when it is missing. */
export function loadChanges(dir: string = changesDir()): ChangeEntry[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }

  const entries: ChangeEntry[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith(".md") || name.toLowerCase() === "readme.md") continue;
    const entry = parseChange(name.slice(0, -3), readFileSync(join(dir, name), "utf8"));
    if (entry) entries.push(entry);
    else console.warn(`trove-kb: skipping changes/${name}: it needs a type and a body`);
  }
  return entries;
}
