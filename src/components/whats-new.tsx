"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChangeKey, ChangeList } from "@/components/change-list";
import { useMessages } from "@/i18n/client";
import type { ChangeEntry } from "@/lib/changes";
import { markWhatsNewSeenAction } from "@/app/whats-new-actions";

export type WhatsNewRelease = {
  id: number;
  version: string | null;
  /** Already formatted for the reader's locale. */
  date: string;
  entries: ChangeEntry[];
};

/**
 * The pop-up after an update. The server hands it the releases this person
 * has not closed yet, already filtered to what concerns them; closing it
 * records the newest, so it shows once per update.
 */
export function WhatsNew({ releases }: { releases: WhatsNewRelease[] }) {
  const t = useMessages();
  const [open, setOpen] = useState(releases.length > 0);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    const newest = Math.max(...releases.map((release) => release.id));
    void markWhatsNewSeenAction(newest).catch(() => {});
  }, [releases]);

  useEffect(() => {
    if (!open) return;
    buttonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  if (!open || releases.length === 0) return null;

  const newest = releases[0]!;
  const several = releases.length > 1;
  const title = newest.version ? t.whatsNew.titleVersion(newest.version) : t.whatsNew.title;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg border bg-[var(--card)] text-[var(--card-foreground)] shadow-xl"
      >
        <div className="border-b px-6 pt-5 pb-3">
          <h2 id="whats-new-title" className="text-lg font-semibold tracking-tight">
            {title}
          </h2>
          <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
            {several ? t.whatsNew.several(releases.length) : t.whatsNew.updated(newest.date)}
          </p>
        </div>

        <div className="flex flex-col gap-5 overflow-y-auto px-6 py-4">
          {releases.map((release) => (
            <div key={release.id}>
              {several && (
                <p className="mb-2 text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                  <span className="font-mono normal-case">{release.version ?? t.whatsNew.title}</span>
                  {" · "}
                  {release.date}
                </p>
              )}
              <ChangeList entries={release.entries} />
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-6 py-3">
          <ChangeKey />
          <Button ref={buttonRef} onClick={close}>
            {t.whatsNew.gotIt}
          </Button>
        </div>
      </div>
    </div>
  );
}
