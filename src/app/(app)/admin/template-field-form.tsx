"use client";

import { useEffect, useRef, useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/alert";
import type { FormState } from "@/lib/form";
import { useMessages } from "@/i18n/client";
import { addTemplateFieldAction, updateTemplateFieldAction } from "./actions";
import { Select } from "@/components/ui/select";
import { NetworkFieldSettings } from "@/components/fields/network-field-settings";
import type { MacFormat } from "@/lib/net/mac";

export type FieldTypeChoice = {
  value: string;
  label: string;
  usesOptionList: boolean;
  usesLinkDocType: boolean;
};
export type OptionListChoice = { id: string; name: string };
export type DocTypeChoice = { id: string; name: string };

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  const t = useMessages();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? t.common.saving : label}
    </Button>
  );
}

function Controls({
  fieldTypes,
  optionLists,
  docTypes,
  instanceMacFormat,
  fieldErrors,
  defaults,
}: {
  fieldTypes: FieldTypeChoice[];
  optionLists: OptionListChoice[];
  docTypes: DocTypeChoice[];
  instanceMacFormat: MacFormat;
  fieldErrors: Record<string, string>;
  defaults: {
    label?: string;
    fieldType?: string;
    optionListId?: string | null;
    linkDocTypeId?: string | null;
    macFormat?: string | null;
    required?: boolean;
  };
}) {
  const t = useMessages();
  const [fieldType, setFieldType] = useState(defaults.fieldType ?? "text");
  const [macFormat, setMacFormat] = useState(defaults.macFormat ?? "");
  const choice = fieldTypes.find((t) => t.value === fieldType);
  const needsList = choice?.usesOptionList ?? false;
  const needsDocType = choice?.usesLinkDocType ?? false;

  return (
    <>
      <Field id="label" label={t.editor.label} error={fieldErrors.label}>
        <Input
          id="label"
          name="label"
          defaultValue={defaults.label ?? ""}
          required
          maxLength={200}
          aria-invalid={!!fieldErrors.label}
        />
      </Field>

      <Field id="fieldType" label={t.editor.type} error={fieldErrors.fieldType}>
        <Select
          id="fieldType"
          name="fieldType"
          value={fieldType}
          onChange={(event) => setFieldType(event.target.value)}
          className="h-10 w-full rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          {fieldTypes.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </Select>
      </Field>

      {needsList && (
        <Field id="optionListId" label={t.editor.optionList} error={fieldErrors.optionListId}>
          <Select
            id="optionListId"
            name="optionListId"
            defaultValue={defaults.optionListId ?? ""}
            className="h-10 w-full rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            <option value="">{t.editor.chooseList}</option>
            {optionLists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {needsDocType && (
        <Field
          id="linkDocTypeId"
          label={t.editor.linksTo}
          error={fieldErrors.linkDocTypeId}
          hint={t.admin.docTypes.linkHint}
        >
          <Select
            id="linkDocTypeId"
            name="linkDocTypeId"
            defaultValue={defaults.linkDocTypeId ?? ""}
            className="h-10 w-full rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            <option value="">{t.editor.anyDocumentInCompany}</option>
            {docTypes.map((docType) => (
              <option key={docType.id} value={docType.id}>
                {docType.name}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <NetworkFieldSettings
        fieldType={fieldType}
        instanceMacFormat={instanceMacFormat}
        macFormat={macFormat}
        onMacFormatChange={setMacFormat}
        name="macFormat"
        idPrefix="template"
      />
      {fieldErrors.macFormat && (
        <p className="text-sm text-[var(--destructive)]">{fieldErrors.macFormat}</p>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="required"
          defaultChecked={defaults.required ?? false}
          className="size-4 rounded border"
        />
        {t.common.required}
      </label>
    </>
  );
}

export function AddTemplateFieldForm({
  docTypeId,
  fieldTypes,
  optionLists,
  docTypes,
  instanceMacFormat,
}: {
  docTypeId: string;
  fieldTypes: FieldTypeChoice[];
  optionLists: OptionListChoice[];
  docTypes: DocTypeChoice[];
  instanceMacFormat: MacFormat;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(addTemplateFieldAction, {});
  const formRef = useRef<HTMLFormElement>(null);
  const t = useMessages();

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="flex flex-col gap-4 rounded-md border border-dashed p-4"
    >
      <FormError>{state.error}</FormError>
      <input type="hidden" name="docTypeId" value={docTypeId} />
      <h3 className="text-sm font-semibold">{t.admin.docTypes.addField}</h3>
      <Controls
        fieldTypes={fieldTypes}
        optionLists={optionLists}
        docTypes={docTypes}
        instanceMacFormat={instanceMacFormat}
        fieldErrors={state.fieldErrors ?? {}}
        defaults={{}}
      />
      <div>
        <Submit label={t.admin.docTypes.addFieldSubmit} />
      </div>
    </form>
  );
}

export function EditTemplateFieldForm({
  docTypeId,
  field,
  fieldTypes,
  optionLists,
  docTypes,
  instanceMacFormat,
}: {
  docTypeId: string;
  field: {
    id: string;
    label: string;
    fieldType: string;
    optionListId: string | null;
    linkDocTypeId: string | null;
    macFormat: string | null;
    required: boolean;
  };
  fieldTypes: FieldTypeChoice[];
  optionLists: OptionListChoice[];
  docTypes: DocTypeChoice[];
  instanceMacFormat: MacFormat;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(updateTemplateFieldAction, {});
  const t = useMessages();

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-5">
      <FormError>{state.error}</FormError>
      <input type="hidden" name="id" value={field.id} />
      <input type="hidden" name="docTypeId" value={docTypeId} />
      <Controls
        fieldTypes={fieldTypes}
        optionLists={optionLists}
        docTypes={docTypes}
        instanceMacFormat={instanceMacFormat}
        fieldErrors={state.fieldErrors ?? {}}
        defaults={field}
      />
      <div>
        <Submit label={t.admin.docTypes.saveField} />
      </div>
    </form>
  );
}
