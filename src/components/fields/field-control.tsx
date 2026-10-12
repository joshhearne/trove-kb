"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RichTextEditor } from "@/components/fields/rich-text-editor";
import type { FieldType } from "@/server/fields/types";
import { useMessages } from "@/i18n/client";
import { Select } from "@/components/ui/select";
import { IpControl, IpListControl, IpRangeControl, MacControl } from "@/components/fields/network-controls";
import type { MacFormat } from "@/lib/net/mac";

export type EditableField = {
  id: string;
  label: string;
  fieldType: FieldType;
  required: boolean;
  optionListId: string | null;
  linkDocTypeId: string | null;
  /** mac only: the format in force for this field (its own, else the instance's). */
  macFormat: MacFormat;
  isLocal: boolean;
};

export type FieldOption = { id: string; label: string };

/** Whatever the control currently holds. Validation happens on the server. */
export type FieldFormValue = string | boolean | string[];

/** Mirrors fieldInputName() on the server: values are keyed by field UUID. */
export function inputName(fieldId: string): string {
  return `field:${fieldId}`;
}

/** Turns a stored value into what the control should start with. */
export function toFormValue(fieldType: FieldType, stored: unknown): FieldFormValue {
  if (fieldType === "boolean") return stored === true;
  if (fieldType === "multi_dropdown" || fieldType === "ip_list") {
    return Array.isArray(stored) ? stored.map(String) : [];
  }
  if (fieldType === "secret_ref") {
    // The control posts the item id; the stored value is the reference object.
    if (stored !== null && typeof stored === "object") {
      const itemId = (stored as { item_id?: unknown }).item_id;
      return typeof itemId === "string" ? itemId : "";
    }
    return "";
  }
  return stored === null || stored === undefined ? "" : String(stored);
}

const selectClass =
  "h-10 w-full rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

/**
 * A controlled field control. The editor keeps values in state so that adding a
 * field, adding an option, or reordering never discards work in progress.
 */
export function FieldControl({
  field,
  value,
  onChange,
  options,
  error,
  onAddOption,
}: {
  field: EditableField;
  value: FieldFormValue;
  onChange: (next: FieldFormValue) => void;
  options: FieldOption[];
  error?: string | undefined;
  /** Rule 4: the inline "+" beside a dropdown. Omitted when not permitted. */
  onAddOption?: ((label: string) => Promise<FieldOption | null>) | undefined;
}) {
  const name = inputName(field.id);
  const id = `f-${field.id}`;
  const invalid = !!error;
  const t = useMessages();

  const asText = typeof value === "string" ? value : "";
  const checked = value === true;
  const selected = Array.isArray(value) ? value : [];

  return (
    <div className="flex flex-col gap-2">
      {renderControl()}
      {error && <p className="text-sm text-[var(--destructive)]">{error}</p>}
    </div>
  );

  function renderControl() {
    switch (field.fieldType) {
      case "markdown":
      case "richtext":
        return (
          <RichTextEditor
            name={name}
            mode={field.fieldType}
            value={asText}
            onChange={onChange}
            ariaLabelledBy={`${id}-label`}
          />
        );

      case "boolean":
        return (
          <label className="flex items-center gap-2 text-sm">
            {/* Keeps the field present in the form even when unticked. */}
            <input type="hidden" name={name} value="" />
            <input
              id={id}
              type="checkbox"
              name={name}
              value="on"
              checked={checked}
              onChange={(event) => onChange(event.target.checked)}
              className="size-4 rounded border"
            />
            Yes
          </label>
        );

      case "number":
        return (
          <Input
            id={id}
            name={name}
            type="number"
            step="any"
            value={asText}
            onChange={(event) => onChange(event.target.value)}
            aria-invalid={invalid}
          />
        );

      case "date":
        return (
          <Input
            id={id}
            name={name}
            type="date"
            value={asText}
            onChange={(event) => onChange(event.target.value)}
            aria-invalid={invalid}
          />
        );

      case "url":
        return (
          <Input
            id={id}
            name={name}
            type="url"
            inputMode="url"
            placeholder="https://"
            value={asText}
            onChange={(event) => onChange(event.target.value)}
            aria-invalid={invalid}
          />
        );

      case "ip":
      case "network":
        return (
          <IpControl
            id={id}
            name={name}
            label={field.label}
            role={field.fieldType}
            value={asText}
            onChange={onChange}
            invalid={invalid}
          />
        );

      case "ip_list":
        return (
          <IpListControl
            id={id}
            name={name}
            label={field.label}
            value={selected}
            onChange={onChange}
            invalid={invalid}
          />
        );

      case "ip_range":
        return (
          <IpRangeControl
            id={id}
            name={name}
            label={field.label}
            value={asText}
            onChange={onChange}
            invalid={invalid}
          />
        );

      case "mac":
        return (
          <MacControl
            id={id}
            name={name}
            format={field.macFormat}
            value={asText}
            onChange={onChange}
            invalid={invalid}
          />
        );

      case "vlan":
        return (
          <Input
            id={id}
            name={name}
            type="number"
            inputMode="numeric"
            min={1}
            max={4094}
            step={1}
            placeholder="1–4094"
            value={asText}
            onChange={(event) => onChange(event.target.value)}
            aria-invalid={invalid}
            className="w-40"
          />
        );

      case "hostname":
        return (
          <Input
            id={id}
            name={name}
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            value={asText}
            onChange={(event) => onChange(event.target.value)}
            onBlur={(event) => onChange(event.target.value.trim().toLowerCase())}
            aria-invalid={invalid}
            className="font-mono"
          />
        );

      case "dropdown":
        return (
          <div className="flex items-start gap-2">
            <Select
              id={id}
              name={name}
              value={asText}
              onChange={(event) => onChange(event.target.value)}
              aria-invalid={invalid}
              className={selectClass}
            >
              <option value="">—</option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </Select>
            {onAddOption && (
              <AddOptionButton
                fieldLabel={field.label}
                onAdd={async (label) => {
                  const added = await onAddOption(label);
                  if (added) onChange(added.id);
                }}
              />
            )}
          </div>
        );

      case "multi_dropdown":
        return (
          <div className="flex items-start gap-2">
            <fieldset
              aria-labelledby={`${id}-label`}
              className="flex flex-1 flex-col gap-1 rounded-md border p-3"
            >
              {/* Keeps the field present when every box is cleared. */}
              <input type="hidden" name={name} value="" />
              {options.length === 0 && (
                <p className="text-sm text-[var(--muted-foreground)]">{t.editor.emptyList}</p>
              )}
              {options.map((option) => (
                <label key={option.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name={name}
                    value={option.id}
                    checked={selected.includes(option.id)}
                    onChange={(event) =>
                      onChange(
                        event.target.checked
                          ? [...selected, option.id]
                          : selected.filter((id) => id !== option.id),
                      )
                    }
                    className="size-4 rounded border"
                  />
                  {option.label}
                </label>
              ))}
            </fieldset>
            {onAddOption && (
              <AddOptionButton
                fieldLabel={field.label}
                onAdd={async (label) => {
                  const added = await onAddOption(label);
                  if (added) onChange([...selected, added.id]);
                }}
              />
            )}
          </div>
        );

      case "doc_link":
        return (
          <Select
            id={id}
            name={name}
            value={asText}
            onChange={(event) => onChange(event.target.value)}
            aria-invalid={invalid}
            className={selectClass}
          >
            <option value="">—</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Select>
        );

      case "secret_ref":
        if (options.length === 0) {
          return (
            <p className="rounded-md border border-dashed px-3 py-2 text-sm text-[var(--muted-foreground)]">
              {t.editor.noVaultItems}
            </p>
          );
        }
        return (
          <Select
            id={id}
            name={name}
            value={asText}
            onChange={(event) => onChange(event.target.value)}
            aria-invalid={invalid}
            className={selectClass}
          >
            <option value="">—</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Select>
        );

      default:
        return (
          <Input
            id={id}
            name={name}
            value={asText}
            onChange={(event) => onChange(event.target.value)}
            aria-invalid={invalid}
          />
        );
    }
  }
}

/** The "+" beside a dropdown: adds to the shared list and selects the result. */
function AddOptionButton({
  fieldLabel,
  onAdd,
}: {
  fieldLabel: string;
  onAdd: (label: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const t = useMessages();

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={t.editor.addOptionTo(fieldLabel)}
        onClick={() => setOpen(true)}
      >
        <Plus className="size-4" aria-hidden />
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        autoFocus
        aria-label={t.editor.newOptionFor(fieldLabel)}
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void submit();
          }
          if (event.key === "Escape") setOpen(false);
        }}
        className="w-48"
      />
      <Button type="button" size="sm" disabled={busy || label.trim() === ""} onClick={submit}>
        {busy ? t.editor.adding : t.editor.add}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
        {t.common.cancel}
      </Button>
    </div>
  );

  async function submit() {
    if (label.trim() === "") return;
    setBusy(true);
    try {
      await onAdd(label.trim());
      setLabel("");
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }
}

/** Label row shared by the create form and the inline editor. */
export function FieldLabel({ field }: { field: EditableField }) {
  const t = useMessages();

  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={`f-${field.id}`} id={`f-${field.id}-label`}>
        {field.label}
        {/* Decoration: the control itself is marked required, and a screen
            reader should not read the label as "Name star". */}
        {field.required && (
          <span aria-hidden="true" className="text-[var(--destructive)]">
            {" *"}
          </span>
        )}
      </Label>
      {field.isLocal && (
        <span className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
          {t.editor.thisDocument}
        </span>
      )}
    </div>
  );
}
