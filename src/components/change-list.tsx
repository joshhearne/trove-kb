"use client";

import { Fragment } from "react";
import { useMessages } from "@/i18n/client";
import { CHANGE_KINDS, type ChangeEntry, type ChangeKind } from "@/lib/changes";
import { cn } from "@/lib/utils";

/** Blue for a feature, green for an improvement, orange for a fix. */
const DOT: Record<ChangeKind, string> = {
  feature: "bg-blue-500",
  improvement: "bg-green-500",
  fix: "bg-orange-500",
};

/**
 * The little Markdown a change file uses inline: **bold** and `code`. Built as
 * React nodes, never as HTML, so a change file cannot inject markup.
 */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
          return <strong key={index}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
          return (
            <code key={index} className="rounded bg-[var(--muted)] px-1 font-mono text-[0.85em]">
              {part.slice(1, -1)}
            </code>
          );
        }
        return <Fragment key={index}>{part}</Fragment>;
      })}
    </>
  );
}

/** Features, then improvements, then fixes, each bullet colored by its kind. */
export function ChangeList({ entries }: { entries: ChangeEntry[] }) {
  const t = useMessages();
  const rows = CHANGE_KINDS.flatMap((kind) =>
    entries
      .filter((entry) => entry.kind === kind)
      .flatMap((entry) => entry.items.map((text, index) => ({ key: `${entry.id}-${index}`, kind, text }))),
  );

  if (rows.length === 0) {
    return <p className="text-sm text-[var(--muted-foreground)]">{t.whatsNew.empty}</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => (
        <li key={row.key} className="flex items-start gap-2.5 text-sm">
          <span
            className={cn("mt-[7px] size-2 shrink-0 rounded-full", DOT[row.kind])}
            title={t.whatsNew.kinds[row.kind]}
            aria-label={t.whatsNew.kinds[row.kind]}
          />
          <span className="min-w-0 flex-1">
            <Inline text={row.text} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** What the colors mean. */
export function ChangeKey({ className }: { className?: string }) {
  const t = useMessages();
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--muted-foreground)]", className)}>
      {CHANGE_KINDS.map((kind) => (
        <span key={kind} className="inline-flex items-center gap-1.5">
          <span className={cn("size-2 rounded-full", DOT[kind])} aria-hidden />
          {t.whatsNew.kinds[kind]}
        </span>
      ))}
    </div>
  );
}
