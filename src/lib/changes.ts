/**
 * Change files. Every user-visible change ships as one small Markdown file in
 * changes/ at the root of the repository (see changes/README.md):
 *
 *   ---
 *   type: feature          # feature | improvement | fix
 *   audience: everyone     # everyone | admins (default: admins)
 *   ---
 *   Imported articles keep their numbered steps.
 *
 * The files travel with the build. On boot the app records the ones it has not
 * seen as a release (src/server/services/whats-new.ts), and the host updater
 * sends the ones a newer build would bring, so administrators see what is
 * coming before it installs. Pure, so the server, the
 * interface and the tests share it; reading the files from disk is
 * src/server/updates/changes.ts.
 */

export const CHANGE_KINDS = ["feature", "improvement", "fix"] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

export const CHANGE_AUDIENCES = ["everyone", "admins"] as const;
export type ChangeAudience = (typeof CHANGE_AUDIENCES)[number];

export type ChangeEntry = {
  /** The file name without .md. Never renamed once shipped. */
  id: string;
  kind: ChangeKind;
  audience: ChangeAudience;
  /** One bullet each, Markdown. */
  items: string[];
};

const KIND_ALIASES: Record<string, ChangeKind> = {
  feature: "feature",
  feat: "feature",
  added: "feature",
  new: "feature",
  improvement: "improvement",
  improved: "improvement",
  changed: "improvement",
  enhancement: "improvement",
  fix: "fix",
  fixed: "fix",
  bugfix: "fix",
  bug: "fix",
};

const AUDIENCE_ALIASES: Record<string, ChangeAudience> = {
  everyone: "everyone",
  all: "everyone",
  users: "everyone",
  admins: "admins",
  admin: "admins",
  administrators: "admins",
  staff: "admins",
};

const MAX_ITEM_LENGTH = 500;
const MAX_ITEMS = 20;
const MAX_ID_LENGTH = 200;

/** Parses one change file, or null when it is not a usable entry. */
export function parseChange(id: string, text: string): ChangeEntry | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) return null;

  const meta: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const pair = /^\s*([A-Za-z_]+)\s*:\s*([^#]*)/.exec(line);
    if (pair) meta[pair[1]!.toLowerCase()] = pair[2]!.trim().toLowerCase();
  }
  const kind = KIND_ALIASES[meta.type ?? meta.kind ?? ""];
  if (!kind) return null;
  const audience = AUDIENCE_ALIASES[meta.audience ?? ""] ?? "admins";

  // One bullet per paragraph, or per "- " item when the body is a list.
  const items: string[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) items.push(paragraph.join(" "));
    paragraph = [];
  };
  for (const raw of match[2]!.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      flush();
      paragraph.push(bullet[1]!);
    } else {
      paragraph.push(line);
    }
  }
  flush();

  const clean = items
    .map((item) => item.trim().slice(0, MAX_ITEM_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_ITEMS);
  if (clean.length === 0) return null;

  return { id: id.slice(0, MAX_ID_LENGTH), kind, audience, items: clean };
}

/** Only what this reader may see: administrators see every entry. */
export function visibleTo<T extends { audience: string }>(entries: T[], administrator: boolean): T[] {
  return administrator ? entries : entries.filter((entry) => entry.audience === "everyone");
}
