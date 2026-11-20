"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/alert";
import {
  FieldControl,
  FieldLabel,
  toFormValue,
  type EditableField,
  type FieldFormValue,
  type FieldOption,
} from "@/components/fields/field-control";
import type { FormState } from "@/lib/form";
import { useMessages } from "@/i18n/client";
import { createDocumentAction } from "./actions";
import { addOptionItemInlineAction } from "./inline-actions";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  const t = useMessages();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? t.common.saving : label}
    </Button>
  );
}

/**
 * Create form. Fields come from the doc type's template; local fields and
 * reordering arrive once the document exists, in the inline editor. The "+"
 * beside a dropdown works here too: nobody should have to save a half-filled
 * document to add the option it needs.
 */
export function DocumentForm({
  companyId,
  docTypeId,
  locationId,
  fields,
  options: initialOptions,
  linkTargets,
  secretItems,
}: {
  companyId: string;
  docTypeId: string;
  locationId: string | null;
  fields: EditableField[];
  options: Record<string, FieldOption[]>;
  /** Documents each doc_link field may point at, keyed by field id. */
  linkTargets: Record<string, FieldOption[]>;
  /** Vault items each secret_ref field may reference, keyed by field id. */
  secretItems: Record<string, FieldOption[]>;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(createDocumentAction, {});
  const [values, setValues] = useState<Record<string, FieldFormValue>>(() =>
    Object.fromEntries(fields.map((field) => [field.id, toFormValue(field.fieldType, null)])),
  );
  const [options, setOptions] = useState(initialOptions);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fieldErrors = state.fieldErrors ?? {};
  const t = useMessages();

  async function addOption(listId: string, label: string): Promise<FieldOption | null> {
    const result = await addOptionItemInlineAction(null, listId, label);
    if (!result.ok) {
      setNotice(null);
      setInlineError(result.error ?? result.fieldErrors?.label ?? t.editor.failed);
      return null;
    }
    setInlineError(null);
    setNotice(t.editor.addedOption(result.data.label));
    setOptions((current) => ({
      ...current,
      [listId]: [...(current[listId] ?? []), result.data],
    }));
    return result.data;
  }

  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-6 has-[[data-md-split]]:max-w-none">
      <FormError>{state.error ?? inlineError}</FormError>
      {notice && (
        <p role="status" className="text-sm text-[var(--muted-foreground)]">
          {notice}
        </p>
      )}
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="docTypeId" value={docTypeId} />
      {locationId && <input type="hidden" name="locationId" value={locationId} />}

      <Field id="title" label={t.common.title} error={fieldErrors.title}>
        <Input id="title" name="title" required maxLength={300} autoFocus aria-invalid={!!fieldErrors.title} />
      </Field>

      {fields.map((field) => (
        <div key={field.id} className="flex flex-col gap-2">
          <FieldLabel field={field} />
          <FieldControl
            field={field}
            value={values[field.id] ?? toFormValue(field.fieldType, null)}
            onChange={(next) => setValues((current) => ({ ...current, [field.id]: next }))}
            options={
              field.fieldType === "doc_link"
                ? (linkTargets[field.id] ?? [])
                : field.fieldType === "secret_ref"
                  ? (secretItems[field.id] ?? [])
                  : field.optionListId
                    ? (options[field.optionListId] ?? [])
                    : []
            }
            error={fieldErrors[field.id]}
            onAddOption={
              field.optionListId
                ? (label) => addOption(field.optionListId as string, label)
                : undefined
            }
          />
        </div>
      ))}

      <div>
        <Submit label={t.documents.create} />
      </div>
    </form>
  );
}
