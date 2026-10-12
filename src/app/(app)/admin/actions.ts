"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { checkbox, text, toFieldErrors, type FormState } from "@/lib/form";
import { ForbiddenError, requireDocTypeManager } from "@/server/auth/session";
import { NotFoundError } from "@/server/services/companies";
import {
  addTemplateField,
  archiveDocType,
  archiveField,
  createDocType,
  reorderTemplateFields,
  unarchiveDocType,
  unarchiveField,
  updateDocType,
  updateTemplateField,
} from "@/server/services/doc-types";
import {
  addOptionItem,
  archiveOptionItem,
  createOptionList,
  DuplicateOptionError,
  renameOptionList,
  unarchiveOptionItem,
} from "@/server/services/option-lists";

function toFormState(err: unknown): FormState {
  if (err instanceof ZodError) return { fieldErrors: toFieldErrors(err) };
  if (err instanceof ForbiddenError) return { error: err.message };
  if (err instanceof NotFoundError) return { error: err.message };
  if (err instanceof DuplicateOptionError) return { fieldErrors: { label: err.message } };
  throw err;
}

function docTypeInput(formData: FormData) {
  return {
    name: text(formData, "name") ?? "",
    icon: text(formData, "icon") ?? null,
    scope: (text(formData, "scope") ?? "location") as "company" | "location",
  };
}

export async function createDocTypeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let id: string;
  try {
    const user = await requireDocTypeManager();
    ({ id } = await createDocType(docTypeInput(formData), user.id));
  } catch (err) {
    return toFormState(err);
  }

  revalidatePath("/admin/doc-types");
  redirect(`/admin/doc-types/${id}`);
}

export async function updateDocTypeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = text(formData, "id");
  if (!id) return { error: "Missing doc type" };

  try {
    const user = await requireDocTypeManager();
    await updateDocType(id, docTypeInput(formData), user.id);
  } catch (err) {
    return toFormState(err);
  }

  revalidatePath("/admin/doc-types");
  revalidatePath(`/admin/doc-types/${id}`);
  return { ok: true };
}

export async function archiveDocTypeAction(formData: FormData): Promise<void> {
  const id = text(formData, "id");
  if (!id) return;
  const user = await requireDocTypeManager();
  await archiveDocType(id, user.id);
  revalidatePath("/admin/doc-types");
  redirect("/admin/doc-types");
}

export async function unarchiveDocTypeAction(formData: FormData): Promise<void> {
  const id = text(formData, "id");
  if (!id) return;
  const user = await requireDocTypeManager();
  await unarchiveDocType(id, user.id);
  revalidatePath("/admin/doc-types");
}

function templateFieldInput(formData: FormData) {
  return {
    label: text(formData, "label") ?? "",
    fieldType: (text(formData, "fieldType") ?? "text") as never,
    optionListId: text(formData, "optionListId") ?? null,
    linkDocTypeId: text(formData, "linkDocTypeId") ?? null,
    macFormat: (text(formData, "macFormat") ?? null) as never,
    required: checkbox(formData, "required"),
  };
}

export async function addTemplateFieldAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const docTypeId = text(formData, "docTypeId");
  if (!docTypeId) return { error: "Missing doc type" };

  try {
    const user = await requireDocTypeManager();
    await addTemplateField(docTypeId, templateFieldInput(formData), user.id);
  } catch (err) {
    return toFormState(err);
  }

  revalidatePath(`/admin/doc-types/${docTypeId}`);
  return { ok: true };
}

export async function updateTemplateFieldAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = text(formData, "id");
  const docTypeId = text(formData, "docTypeId");
  if (!id || !docTypeId) return { error: "Missing field" };

  try {
    const user = await requireDocTypeManager();
    await updateTemplateField(id, templateFieldInput(formData), user.id);
  } catch (err) {
    return toFormState(err);
  }

  revalidatePath(`/admin/doc-types/${docTypeId}`);
  redirect(`/admin/doc-types/${docTypeId}`);
}

export async function archiveFieldAction(formData: FormData): Promise<void> {
  const id = text(formData, "id");
  const docTypeId = text(formData, "docTypeId");
  if (!id || !docTypeId) return;
  const user = await requireDocTypeManager();
  await archiveField(id, user.id);
  revalidatePath(`/admin/doc-types/${docTypeId}`);
}

export async function unarchiveFieldAction(formData: FormData): Promise<void> {
  const id = text(formData, "id");
  const docTypeId = text(formData, "docTypeId");
  if (!id || !docTypeId) return;
  const user = await requireDocTypeManager();
  await unarchiveField(id, user.id);
  revalidatePath(`/admin/doc-types/${docTypeId}`);
}

/** Moves one field up or down. Full drag-and-drop reordering lands in Phase 3. */
export async function moveTemplateFieldAction(formData: FormData): Promise<void> {
  const docTypeId = text(formData, "docTypeId");
  const id = text(formData, "id");
  const direction = text(formData, "direction");
  const order = (text(formData, "order") ?? "").split(",").filter(Boolean);
  if (!docTypeId || !id || !direction || order.length === 0) return;

  const from = order.indexOf(id);
  const to = direction === "up" ? from - 1 : from + 1;
  if (from < 0 || to < 0 || to >= order.length) return;

  const reordered = [...order];
  const [moved] = reordered.splice(from, 1);
  if (moved) reordered.splice(to, 0, moved);

  const user = await requireDocTypeManager();
  await reorderTemplateFields(docTypeId, reordered, user.id);
  revalidatePath(`/admin/doc-types/${docTypeId}`);
}

export async function createOptionListAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  let id: string;
  try {
    const user = await requireDocTypeManager();
    ({ id } = await createOptionList({ name: text(formData, "name") ?? "" }, user.id));
  } catch (err) {
    return toFormState(err);
  }

  revalidatePath("/admin/option-lists");
  redirect(`/admin/option-lists/${id}`);
}

export async function renameOptionListAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = text(formData, "id");
  if (!id) return { error: "Missing option list" };

  try {
    const user = await requireDocTypeManager();
    await renameOptionList(id, { name: text(formData, "name") ?? "" }, user.id);
  } catch (err) {
    return toFormState(err);
  }

  revalidatePath("/admin/option-lists");
  revalidatePath(`/admin/option-lists/${id}`);
  return { ok: true };
}

export async function addOptionItemAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const listId = text(formData, "listId");
  if (!listId) return { error: "Missing option list" };

  try {
    const user = await requireDocTypeManager();
    await addOptionItem(listId, { label: text(formData, "label") ?? "" }, user.id);
  } catch (err) {
    return toFormState(err);
  }

  revalidatePath(`/admin/option-lists/${listId}`);
  return { ok: true };
}

export async function archiveOptionItemAction(formData: FormData): Promise<void> {
  const id = text(formData, "id");
  const listId = text(formData, "listId");
  if (!id || !listId) return;
  const user = await requireDocTypeManager();
  await archiveOptionItem(id, user.id);
  revalidatePath(`/admin/option-lists/${listId}`);
}

export async function unarchiveOptionItemAction(formData: FormData): Promise<void> {
  const id = text(formData, "id");
  const listId = text(formData, "listId");
  if (!id || !listId) return;
  const user = await requireDocTypeManager();
  await unarchiveOptionItem(id, user.id);
  revalidatePath(`/admin/option-lists/${listId}`);
}
