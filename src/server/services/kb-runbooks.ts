import "server-only";
import { getArticle, type ArticleDetail, type KbReader } from "@/server/services/kb";
import { flattenNested, nestRunbook, type NestedStep } from "@/server/kb/runbook-nest";

/**
 * A runbook as its reader may follow it: each step that is only a link to
 * another runbook opened into that runbook's steps (src/server/kb/runbook-nest.ts),
 * every runbook read through the same KbReader, so a runbook the reader may
 * not read stays a single step and its steps are never shown.
 */
export async function expandRunbook(article: Pick<ArticleDetail, "id" | "kind" | "steps">, reader: KbReader): Promise<NestedStep[]> {
  if (article.kind !== "runbook") return [];
  return nestRunbook(article.id, article.steps, async (id) => {
    const found = await getArticle(id, reader);
    return found && found.kind === "runbook" ? { id: found.id, title: found.title, steps: found.steps } : null;
  });
}

/** Every text a nested runbook shows, for resolving the [[links]] in all of them at once. */
export function nestedTexts(steps: readonly NestedStep[]): string[] {
  return flattenNested(steps).flatMap((step) => [step.text, step.note ?? ""]);
}
