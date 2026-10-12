"use client";

import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { useMessages } from "@/i18n/client";
import { MAC_FORMATS, macFormatExample, type MacFormat } from "@/lib/net/mac";

/**
 * What a network field type asks for, or says, when it is being created:
 * a format for a MAC address field, and for the others a note on what the
 * document will show. Shared by Admin → Doc types and "Add field".
 *
 * Renders nothing for the other field types.
 */
export function NetworkFieldSettings({
  fieldType,
  instanceMacFormat,
  macFormat,
  onMacFormatChange,
  name,
  idPrefix,
}: {
  fieldType: string;
  instanceMacFormat: MacFormat;
  /** The field's own format; "" follows the instance. */
  macFormat: string;
  onMacFormatChange: (next: string) => void;
  /** Set when the select belongs to a plain form post. */
  name?: string;
  idPrefix: string;
}) {
  const t = useMessages();
  const net = t.editor.net;

  const note = (text: string) => (
    <p className="rounded-md bg-[var(--muted)] px-3 py-2 text-sm text-[var(--muted-foreground)]">
      {text}
    </p>
  );

  switch (fieldType) {
    case "ip":
      return note(net.ipHint);
    case "ip_list":
      return note(net.ipListHint);
    case "network":
      return note(net.networkHint);
    case "ip_range":
      return note(net.rangeHint);
    case "vlan":
      return note(net.vlanHint);
    case "hostname":
      return note(net.hostnameHint);
    case "port":
      return note(net.portHint);
    case "port_range":
      return note(net.portRangeHint);
    case "port_list":
      return note(net.portListHint);
    case "asn":
      return note(net.asnHint);
    case "mac":
      return (
        <Field id={`${idPrefix}-mac-format`} label={net.macFormat} hint={net.macHint}>
          <Select
            id={`${idPrefix}-mac-format`}
            name={name}
            value={macFormat}
            onChange={(event) => onMacFormatChange(event.target.value)}
            className="h-10 w-full rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            <option value="">{net.macFormatDefault(macFormatExample(instanceMacFormat))}</option>
            {MAC_FORMATS.map((format) => (
              <option key={format} value={format}>
                {`${net.macFormats[format]}: ${macFormatExample(format)}`}
              </option>
            ))}
          </Select>
        </Field>
      );
    default:
      return null;
  }
}
