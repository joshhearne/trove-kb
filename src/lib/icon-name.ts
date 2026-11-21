/**
 * Doc type icons are stored by their lucide name, the kebab-case one the lucide
 * site shows ("building-2", "globe-lock"). lucide-react exports the components
 * in PascalCase ("Building2", "GlobeLock"). Both spellings share one key: the
 * letters and digits, lowercased, so "arrow-down-a-z" and "ArrowDownAZ" meet.
 */

/** The key both spellings of an icon's name share. */
export function iconKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** "GlobeLock" → "globe-lock". The name the lucide site shows, and what is stored. */
export function iconStoredName(componentName: string): string {
  return componentName
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    // A digit after letters starts a new word ("building-2"), unless the letters
    // themselves follow a digit, as in "2x2" or "3d".
    .replace(/(?<![0-9][a-z]*)([a-z])([0-9])/g, "$1-$2")
    .replace(/([0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

/** Letters, digits, and dashes only: what a lucide name is made of. */
export function isIconName(value: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value);
}

/**
 * Looks an icon up by either spelling of its name. The stored name is tried
 * first, so two icons whose names differ only by a dash ("letter-s" and
 * "letters") each keep their own. The dash-free key is the fallback, and a key
 * two icons share answers neither rather than guessing.
 */
export function iconLookup<T>(components: Iterable<[string, T]>): (name: string) => T | undefined {
  const byName = new Map<string, T>();
  const byKey = new Map<string, T | null>();
  for (const [component, value] of components) {
    byName.set(iconStoredName(component), value);
    const key = iconKey(component);
    byKey.set(key, byKey.has(key) ? null : value);
  }
  return (name) => {
    const trimmed = name.trim();
    const stored = /[A-Z]/.test(trimmed) ? iconStoredName(trimmed) : trimmed;
    return byName.get(stored) ?? byKey.get(iconKey(trimmed)) ?? undefined;
  };
}
