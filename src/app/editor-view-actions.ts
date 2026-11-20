"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/auth/session";
import { setEditorView } from "@/server/services/users";
import { isEditorView } from "@/lib/editor-view";

/** Remembers on the account how this person wants a Markdown editor to open. */
export async function setEditorViewAction(formData: FormData): Promise<void> {
  const user = await requireSession();
  const choice = formData.get("editorView");
  if (!isEditorView(choice)) return;
  await setEditorView(user.id, choice);
  revalidatePath("/", "layout");
}
