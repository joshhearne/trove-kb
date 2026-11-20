import type { RunbookStep } from "@/server/kb/runbook";

/**
 * Runbooks made of runbooks. A step that is nothing but a link to another
 * runbook — `3. [[kb:<id>|Create the AD account]]` — stands for all of that
 * runbook's steps: it opens into them, and they into theirs, so one
 * onboarding runbook can list the small ones it needs and stay current as
 * each of them changes.
 *
 * Expanded when read, never stored: the runbook linked to is read as it is
 * now, by the reader it is shown to. Each step it brings is known by its
 * path, `<step>/<step>`, so progress kept elsewhere follows the step even
 * when the same small runbook appears twice. A runbook the reader cannot
 * read, one that leads back to itself, or one nested too deep stays a single
 * step, saying why.
 *
 * Pure: the caller passes in how a runbook is read.
 */

const INCLUDE = /^\s*\[\[kb:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\|([^\]\n]*))?\]\]\s*$/i;

/** How deep runbooks may sit inside one another. */
export const MAX_NESTING = 5;

/** The runbook a step stands for, when its text is nothing but a link to one. */
export function includedRunbook(text: string): { id: string; label: string } | null {
  const match = INCLUDE.exec(text);
  return match ? { id: match[1]!.toLowerCase(), label: match[2]?.trim() ?? "" } : null;
}

export type IncludeStatus = "expanded" | "unavailable" | "loop" | "too-deep";

export type NestedStep = RunbookStep & {
  /** Unique within the whole expanded runbook: the step ids from the top, joined by "/". */
  path: string;
  /** 0 for the runbook's own steps, 1 for the steps of a runbook one of them opens into. */
  depth: number;
  /** The runbook whose step this is. */
  articleId: string;
  /** For a step that is a link to a runbook: which, called what, and whether it opened. */
  runbook?: { id: string; title: string; status: IncludeStatus };
  children: NestedStep[];
};

export type RunbookLoader = (id: string) => Promise<{ id: string; title: string; steps: RunbookStep[] } | null>;

/** A runbook's steps, each one that links to a runbook opened into that runbook's steps. */
export async function nestRunbook(
  articleId: string,
  steps: readonly RunbookStep[],
  load: RunbookLoader,
  options: { maxDepth?: number } = {},
): Promise<NestedStep[]> {
  const maxDepth = options.maxDepth ?? MAX_NESTING;
  const cache = new Map<string, Promise<Awaited<ReturnType<RunbookLoader>>>>();
  const read = (id: string) => {
    let found = cache.get(id);
    if (!found) {
      found = load(id).catch(() => null);
      cache.set(id, found);
    }
    return found;
  };

  async function walk(
    owner: string,
    list: readonly RunbookStep[],
    depth: number,
    prefix: string,
    chain: readonly string[],
  ): Promise<NestedStep[]> {
    const out: NestedStep[] = [];
    for (const step of list) {
      const path = prefix ? `${prefix}/${step.id}` : step.id;
      const node: NestedStep = { ...step, path, depth, articleId: owner, children: [] };
      const include = includedRunbook(step.text);
      if (include) {
        const target = await read(include.id);
        const title = include.label || target?.title || "";
        if (!target) node.runbook = { id: include.id, title, status: "unavailable" };
        else if (chain.includes(target.id)) node.runbook = { id: target.id, title, status: "loop" };
        else if (depth + 1 > maxDepth) node.runbook = { id: target.id, title, status: "too-deep" };
        else {
          node.runbook = { id: target.id, title, status: "expanded" };
          node.children = await walk(target.id, target.steps, depth + 1, path, [...chain, target.id]);
        }
        node.text = title || step.text;
      }
      out.push(node);
    }
    return out;
  }

  return walk(articleId, steps, 0, "", [articleId]);
}

/** Whether a step is ticked by ticking the steps inside it, rather than itself. */
export function isGroup(step: NestedStep): boolean {
  return step.children.length > 0;
}

/** The steps that are ticked themselves: every step but those that open into others. */
export function leafSteps(steps: readonly NestedStep[]): NestedStep[] {
  return steps.flatMap((step) => (isGroup(step) ? leafSteps(step.children) : [step]));
}

/** The expanded runbook as one list in reading order, each step with its depth and the group it sits in. */
export function flattenNested(steps: readonly NestedStep[], parent: string | null = null): (NestedStep & { parent: string | null })[] {
  return steps.flatMap((step) => [{ ...step, parent }, ...flattenNested(step.children, step.path)]);
}
