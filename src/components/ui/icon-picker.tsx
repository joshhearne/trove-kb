"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { icons } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { iconKey, iconLookup, iconStoredName } from "@/lib/icon-name";
import { cn } from "@/lib/utils";
import { useMessages } from "@/i18n/client";

type Entry = {
  /** The stored name, as the lucide site shows it: "globe-lock". */
  name: string;
  key: string;
  Icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
};

/** Every icon lucide-react ships, beside the component name it is exported as. */
const ENTRIES: readonly [string, Entry][] = Object.entries(icons).map(([component, Icon]) => [
  component,
  { name: iconStoredName(component), key: iconKey(component), Icon },
]);

/** Every icon, in the order the lucide site lists them. */
const ALL: readonly Entry[] = ENTRIES.map(([, entry]) => entry).sort((a, b) =>
  a.name.localeCompare(b.name, "en-US"),
);

const lookup = iconLookup(ENTRIES);

/** How many icons the grid shows at once; the search narrows the rest. */
const PAGE = 120;

/**
 * Picks a lucide icon by searching what it is called, instead of asking for the
 * name from memory. The choice travels in a hidden input under `name`, as the
 * stored kebab-case name, so the form posts exactly what a text field would.
 */
export function IconPicker({
  id,
  name,
  defaultValue,
}: {
  id: string;
  name: string;
  defaultValue?: string | null;
}) {
  const t = useMessages();
  const [value, setValue] = useState(defaultValue ?? "");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const chosen = value ? lookup(value) : undefined;

  const matches = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return ALL;
    const compact = iconKey(query);
    return ALL.filter(
      (entry) => entry.key === compact || terms.every((term) => entry.name.includes(term)),
    );
  }, [query]);
  const shown = matches.slice(0, PAGE);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    }
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  function choose(entry: Entry | null) {
    setValue(entry?.name ?? "");
    setOpen(false);
    triggerRef.current?.focus();
  }

  const ChosenIcon = chosen?.Icon;

  return (
    <div ref={containerRef} className="relative">
      <input type="hidden" name={name} value={value} />
      <button
        ref={triggerRef}
        id={id}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className={cn(
          "flex h-10 w-full items-center gap-2 rounded-md border bg-transparent px-3 text-left text-sm outline-none",
          "focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
        )}
      >
        {ChosenIcon ? (
          <ChosenIcon className="size-4 shrink-0" aria-hidden />
        ) : (
          <span className="size-4 shrink-0 rounded-sm border border-dashed" aria-hidden />
        )}
        <span className={cn("min-w-0 flex-1 truncate", !chosen && "text-[var(--muted-foreground)]")}>
          {chosen ? chosen.name : value ? value : t.admin.docTypes.noIcon}
        </span>
        <span className="text-xs text-[var(--muted-foreground)]">
          {open ? "▴" : "▾"}
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t.admin.docTypes.chooseIcon}
          className="absolute z-20 mt-1 flex w-full flex-col gap-2 rounded-md border bg-[var(--card)] p-2 shadow-lg"
        >
          <Input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t.admin.docTypes.searchIcons}
            aria-label={t.admin.docTypes.searchIcons}
            className="h-9"
          />
          {shown.length === 0 ? (
            <p className="px-1 py-6 text-center text-sm text-[var(--muted-foreground)]">
              {t.admin.docTypes.noIconMatches(query.trim())}
            </p>
          ) : (
            <ul
              className="grid max-h-64 grid-cols-6 gap-1 overflow-y-auto p-0.5 sm:grid-cols-8"
              aria-label={t.admin.docTypes.chooseIcon}
            >
              {shown.map((entry) => (
                <li key={entry.key}>
                  <button
                    type="button"
                    title={entry.name}
                    aria-label={entry.name}
                    aria-pressed={entry.key === chosen?.key}
                    onClick={() => choose(entry)}
                    className={cn(
                      "flex aspect-square w-full items-center justify-center rounded-md hover:bg-[var(--muted)]",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
                      entry.key === chosen?.key &&
                        "bg-[var(--primary)] text-[var(--primary-foreground)] hover:bg-[var(--primary)]",
                    )}
                  >
                    <entry.Icon className="size-5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-between gap-2 px-1 text-xs text-[var(--muted-foreground)]">
            <span>{t.admin.docTypes.iconsShown(shown.length, matches.length)}</span>
            <Button type="button" variant="ghost" size="sm" onClick={() => choose(null)}>
              {t.admin.docTypes.noIcon}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
