"use client";

import { createContext, useContext, useState } from "react";
import { ListChecks } from "lucide-react";
import { useMessages } from "@/i18n/client";

export type RenderedStep = {
  /** Unique across the whole runbook: a nested step's path, `step/step`. */
  id: string;
  /** The step's text, rendered. */
  html: string;
  /** What sits under the step, rendered, when there is any. */
  noteHtml: string | null;
  canned: string | null;
  /** A step that is a link to another runbook, and whether it opened. */
  runbook: { status: "expanded" | "unavailable" | "loop" | "too-deep" } | null;
  /** The steps of the runbook it opened into. */
  children: RenderedStep[];
};

type Run = { done: Set<string>; set: (ids: string[], on: boolean) => void; total: number };
const RunContext = createContext<Run>({ done: new Set(), set: () => {}, total: 0 });

/** The steps that are ticked themselves: a step that opens into others is ticked through them. */
function leaves(step: RenderedStep): string[] {
  return step.children.length > 0 ? step.children.flatMap(leaves) : [step.id];
}

/**
 * One reading of a runbook. The ticks live in this page alone: Trove KB keeps
 * no record of a run, so nothing here is sent anywhere, and a reload starts
 * over. Wraps every checklist the runbook has, so the count is one count.
 */
export function RunbookRun({ total, children }: { total: number; children: React.ReactNode }) {
  const [done, setDone] = useState<Set<string>>(() => new Set());
  const set = (ids: string[], on: boolean) => {
    setDone((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };
  return <RunContext.Provider value={{ done, set, total }}>{children}</RunContext.Provider>;
}

function Step({ step, label }: { step: RenderedStep; label: string }) {
  const t = useMessages();
  const { done, set } = useContext(RunContext);
  const own = leaves(step);
  const ticked = own.every((id) => done.has(id));
  const some = !ticked && own.some((id) => done.has(id));
  const group = step.children.length > 0;

  return (
    <li id={`step-${step.id}`} className={"flex gap-3 rounded-md border px-3 py-2 " + (ticked ? "opacity-60" : "")}>
      <input
        type="checkbox"
        checked={ticked}
        ref={(box) => {
          if (box) box.indeterminate = some;
        }}
        onChange={() => set(own, !ticked)}
        aria-label={label}
        className="mt-1 size-4 shrink-0 accent-[var(--primary)]"
      />
      <div className="min-w-0 flex-1">
        <div className="flex gap-2">
          <span className="shrink-0 text-sm font-medium tabular-nums text-[var(--muted-foreground)]">{label}.</span>
          <div className="min-w-0 flex-1">
            <div
              className={"prose-editor kb-article min-w-0 text-sm break-words " + (group ? "font-medium " : "") + (ticked ? "line-through" : "")}
              dangerouslySetInnerHTML={{ __html: step.html }}
            />
            {step.runbook && (
              <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
                <ListChecks className="size-3.5" aria-hidden />
                {t.kb.nested[step.runbook.status](step.children.length > 0 ? leaves(step).length : 0)}
              </p>
            )}
          </div>
        </div>
        {step.noteHtml && (
          <div
            className="prose-editor kb-article mt-1 min-w-0 pl-6 text-sm break-words text-[var(--muted-foreground)]"
            dangerouslySetInnerHTML={{ __html: step.noteHtml }}
          />
        )}
        {step.canned && <p className="mt-1 pl-6 text-xs text-[var(--muted-foreground)]">{t.kb.runbookCanned(step.canned)}</p>}
        {group && (
          <ol className="mt-2 flex flex-col gap-2">
            {step.children.map((child, index) => (
              <Step key={child.id} step={child} label={`${label}.${index + 1}`} />
            ))}
          </ol>
        )}
      </div>
    </li>
  );
}

/** A run of a runbook's steps as a checklist, numbered on from the steps before it. */
export function RunbookSteps({ steps, first = 0, last = true }: { steps: RenderedStep[]; first?: number; last?: boolean }) {
  const t = useMessages();
  const { done, total } = useContext(RunContext);
  const count = steps.flatMap(leaves).length;

  return (
    <section aria-label={t.kb.runbookSteps} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">{t.kb.runbookSteps}</h2>
        <span className="text-xs text-[var(--muted-foreground)] tabular-nums">
          {t.kb.runbookDone(done.size, total || count)}
        </span>
      </div>
      <ol className="flex flex-col gap-2" start={first + 1}>
        {steps.map((step, index) => (
          <Step key={step.id} step={step} label={`${first + index + 1}`} />
        ))}
      </ol>
      {last && <p className="text-xs text-[var(--muted-foreground)]">{t.kb.runbookHint}</p>}
    </section>
  );
}
