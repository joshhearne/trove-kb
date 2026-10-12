"use client";

import { useState, type ClipboardEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useLocale, useMessages } from "@/i18n/client";
import { formatCount } from "@/i18n/format";
import {
  describeBlock,
  formatAddress,
  maxPrefix,
  networkOf,
  parseAddress,
  parseCidr,
  parsePrefix,
  parseRange,
  prefixToMask,
  rangeSize,
  splitAddressInput,
  splitAddressList,
  splitRangeInput,
  type IpFamily,
} from "@/lib/net/ip";
import { asnKind, parseAsn } from "@/lib/net/asn";
import { macFormatExample, normalizeMac, parseMac, type MacFormat } from "@/lib/net/mac";
import {
  joinPortStored,
  parsePortSpec,
  portCount,
  PROTOCOLS,
  serviceName,
  splitPortList,
  splitPortStored,
} from "@/lib/net/port";

const selectClass =
  "h-10 rounded-md border bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

const hintClass = "text-xs text-[var(--muted-foreground)]";

function familyOf(address: string): IpFamily {
  return address.includes(":") ? 6 : 4;
}

/**
 * Splits a stored "address/prefix" for the two controls. An ip field saved
 * as /32 (or /128) shows its prefix blank again: that is the single address.
 */
function splitStored(value: string, role: "ip" | "network"): { address: string; prefix: string } {
  const { address, prefix } = splitAddressInput(value);
  const single = String(maxPrefix(familyOf(address)));
  return { address, prefix: prefix === null || (role === "ip" && prefix === single) ? "" : prefix };
}

function joinStored(address: string, prefix: string): string {
  const trimmed = address.trim();
  if (trimmed === "") return "";
  return prefix === "" ? trimmed : `${trimmed}/${prefix}`;
}

/**
 * An address and its prefix. "ip" holds one address: a blank prefix means just
 * that address (/32, /128), and a prefix records the subnet it sits on.
 * "network" holds a block, so the prefix is required and stops short of a
 * single address. Either way the form posts one "address/prefix" string.
 */
export function IpControl({
  id,
  name,
  label,
  role,
  value,
  onChange,
  invalid,
  onPasteList,
}: {
  id: string;
  /** Omitted when a list posts the value instead. */
  name?: string;
  label: string;
  role: "ip" | "network";
  value: string;
  onChange: (next: string) => void;
  invalid: boolean;
  /** In a list, a paste of several addresses goes to the list. */
  onPasteList?: (addresses: string[]) => void;
}) {
  const t = useMessages();
  const locale = useLocale();
  const [address, setAddress] = useState(() => splitStored(value, role).address);
  const [prefix, setPrefix] = useState(() => splitStored(value, role).prefix);

  // Follow the parent when it replaces the value (a reset), not our own echo.
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (value !== joinStored(address, prefix)) {
      const next = splitStored(value, role);
      setAddress(next.address);
      setPrefix(next.prefix);
    }
  }

  const family = familyOf(address);
  const max = maxPrefix(family);
  // An IPv4 mask shown beside its prefix, since that is how many devices ask for it.
  const prefixes = Array.from({ length: max }, (_, i) => max - 1 - i);

  function update(nextAddress: string, nextPrefix: string) {
    setAddress(nextAddress);
    setPrefix(nextPrefix);
    onChange(joinStored(nextAddress, nextPrefix));
  }

  /** "10.0.0.5/24" or "10.0.0.5 255.255.255.0" fills both controls. */
  function absorb(text: string): boolean {
    const split = splitAddressInput(text);
    if (split.prefix === null) return false;
    const parsed = parseAddress(split.address);
    const nextPrefix = parsed ? parsePrefix(split.prefix, parsed.family) : null;
    if (!parsed || nextPrefix === null) return false;
    const keepPrefix = role === "ip" && nextPrefix === maxPrefix(parsed.family) ? "" : String(nextPrefix);
    update(split.address.trim(), keepPrefix);
    return true;
  }

  function onPaste(event: ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData("text");
    if (onPasteList) {
      const addresses = splitAddressList(text);
      if (addresses.length > 1) {
        event.preventDefault();
        onPasteList(addresses);
        return;
      }
    }
    if (absorb(text)) event.preventDefault();
  }

  return (
    <div className="flex flex-col gap-1">
      {name && <input type="hidden" name={name} value={joinStored(address, prefix)} />}
      <div className="flex items-stretch gap-2">
        <Input
          id={id}
          aria-label={t.editor.net.address(label)}
          value={address}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          placeholder={role === "network" ? "192.168.1.0" : "192.168.1.10"}
          onChange={(event) => update(event.target.value, prefix)}
          onPaste={onPaste}
          onBlur={() => absorb(address)}
          aria-invalid={invalid}
          className="min-w-0 flex-1 font-mono"
        />
        <Select
          aria-label={t.editor.net.prefix(label)}
          value={prefix}
          onChange={(event) => update(address, event.target.value)}
          aria-invalid={invalid}
          className={`${selectClass} w-40 shrink-0 font-mono`}
        >
          <option value="">
            {role === "ip" ? t.editor.net.singleAddress(max) : t.editor.net.choosePrefix}
          </option>
          {prefixes.map((n) => (
            <option key={n} value={String(n)}>
              {family === 4 ? `/${n}  ${prefixToMask(n)}` : `/${n}`}
            </option>
          ))}
        </Select>
      </div>
      <p className={hintClass} aria-live="polite">
        {preview() ?? (role === "ip" ? t.editor.net.ipControlHint : t.editor.net.networkControlHint)}
      </p>
    </div>
  );

  function preview(): string | null {
    const parsed = parseCidr(joinStored(address, prefix), role === "ip" ? "host" : null);
    if (!parsed.ok) return null;
    const cidr = parsed.value;
    const top = maxPrefix(cidr.address.family);

    if (role === "ip") {
      if (cidr.prefix === top) return t.editor.net.singleAddressPreview(top);
      const block = describeBlock(cidr);
      return t.editor.net.onNetworkPreview(
        block.network,
        block.firstUsable,
        block.lastUsable,
        formatCount(block.usable, locale),
      );
    }

    if (cidr.prefix === top) return null; // refused on save, with the reason
    const block = describeBlock(cidr);
    const usable = t.editor.net.networkPreview(
      block.firstUsable,
      block.lastUsable,
      formatCount(block.usable, locale),
    );
    const snapped = `${formatAddress(networkOf(cidr))}/${cidr.prefix}`;
    return snapped === `${formatAddress(cidr.address)}/${cidr.prefix}`
      ? usable
      : `${t.editor.net.savedAs(snapped)} ${usable}`;
  }
}

/** Row keys for the list controls: unique for the page's life, never reused. */
let listRowKey = 0;
function row(text: string): { key: number; text: string } {
  return { key: listRowKey++, text };
}

type ListRow = {
  id: string;
  label: string;
  value: string;
  invalid: boolean;
  onChange: (text: string) => void;
  onPasteList: (entries: string[]) => void;
};

/**
 * Rows in order, each its own control, with up, down, and remove, and a
 * paste of several entries filling a row for each. The form posts one value
 * per row, empty rows left out.
 */
function OrderedListControl({
  id,
  name,
  label,
  value,
  onChange,
  invalid,
  addLabel,
  renderRow,
}: {
  id: string;
  name: string;
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  invalid: boolean;
  addLabel: string;
  renderRow: (row: ListRow) => ReactNode;
}) {
  const t = useMessages();
  const [rows, setRows] = useState(() => (value.length === 0 ? [row("")] : value.map(row)));

  function update(next: { key: number; text: string }[]) {
    const kept = next.length === 0 ? [row("")] : next;
    setRows(kept);
    onChange(kept.map((r) => r.text.trim()).filter((text) => text !== ""));
  }

  function move(index: number, by: -1 | 1) {
    const next = [...rows];
    const [moved] = next.splice(index, 1);
    if (moved) next.splice(index + by, 0, moved);
    update(next);
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Keeps the field present when every row is cleared. */}
      <input type="hidden" name={name} value="" />
      {rows.map((r) =>
        r.text.trim() === "" ? null : <input key={r.key} type="hidden" name={name} value={r.text.trim()} />,
      )}
      <ol className="flex flex-col gap-2">
        {rows.map((r, index) => {
          const entry = t.editor.net.listEntry(label, index + 1);
          return (
            <li key={r.key} className="flex items-start gap-1">
              <div className="min-w-0 flex-1">
                {renderRow({
                  id: index === 0 ? id : `${id}-${r.key}`,
                  label: entry,
                  value: r.text,
                  invalid,
                  onChange: (text) =>
                    update(rows.map((other) => (other.key === r.key ? { ...other, text } : other))),
                  onPasteList: (entries) =>
                    update([
                      ...rows.slice(0, index),
                      ...entries.map(row),
                      ...rows.slice(index + 1).filter((other) => other.text.trim() !== ""),
                    ]),
                })}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t.editor.net.moveUp(entry)}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <ArrowUp className="size-4" aria-hidden />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t.editor.net.moveDown(entry)}
                disabled={index === rows.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown className="size-4" aria-hidden />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t.editor.net.remove(entry)}
                onClick={() => update(rows.filter((other) => other.key !== r.key))}
              >
                <X className="size-4" aria-hidden />
              </Button>
            </li>
          );
        })}
      </ol>
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setRows([...rows, row("")])}
        >
          <Plus className="size-4" aria-hidden />
          {addLabel}
        </Button>
      </div>
    </div>
  );
}

type ListControlProps = {
  id: string;
  name: string;
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  invalid: boolean;
};

/**
 * Several addresses in order, such as DNS servers, primary first. Each row
 * works like an IP address field.
 */
export function IpListControl(props: ListControlProps) {
  const t = useMessages();
  return (
    <OrderedListControl
      {...props}
      addLabel={t.editor.net.addAddress}
      renderRow={(r) => <IpControl {...r} role="ip" />}
    />
  );
}

/**
 * Several ports or ranges in order, such as what a firewall rule opens. Each
 * row works like a Port range field, with its own protocol.
 */
export function PortListControl(props: ListControlProps) {
  const t = useMessages();
  return (
    <OrderedListControl
      {...props}
      addLabel={t.editor.net.addPort}
      renderRow={(r) => <PortControl {...r} role="range" />}
    />
  );
}

/** A first and a last address, posted as one "first-last" string. */
export function IpRangeControl({
  id,
  name,
  label,
  value,
  onChange,
  invalid,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  invalid: boolean;
}) {
  const t = useMessages();
  const locale = useLocale();
  const initial = splitRangeInput(value) ?? { start: value, end: "" };
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);

  const joined = (a: string, b: string) =>
    a.trim() === "" && b.trim() === "" ? "" : `${a.trim()}-${b.trim()}`;

  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (value !== joined(start, end)) {
      const next = splitRangeInput(value) ?? { start: value, end: "" };
      setStart(next.start);
      setEnd(next.end);
    }
  }

  function update(a: string, b: string) {
    setStart(a);
    setEnd(b);
    onChange(joined(a, b));
  }

  function onPaste(event: ClipboardEvent<HTMLInputElement>) {
    const split = splitRangeInput(event.clipboardData.getData("text"));
    if (split) {
      event.preventDefault();
      update(split.start, split.end);
    }
  }

  const parsed = parseRange(joined(start, end));

  return (
    <div className="flex flex-col gap-1">
      <input type="hidden" name={name} value={joined(start, end)} />
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={id}
          aria-label={t.editor.net.rangeStart(label)}
          value={start}
          autoComplete="off"
          spellCheck={false}
          placeholder="192.168.1.100"
          onChange={(event) => update(event.target.value, end)}
          onPaste={onPaste}
          aria-invalid={invalid}
          className="min-w-0 flex-1 font-mono"
        />
        <span aria-hidden className="text-[var(--muted-foreground)]">
          –
        </span>
        <Input
          aria-label={t.editor.net.rangeEnd(label)}
          value={end}
          autoComplete="off"
          spellCheck={false}
          placeholder="192.168.1.199"
          onChange={(event) => update(start, event.target.value)}
          aria-invalid={invalid}
          className="min-w-0 flex-1 font-mono"
        />
      </div>
      {parsed.ok && (
        <p className={hintClass} aria-live="polite">
          {t.editor.net.rangePreview(formatCount(rangeSize(parsed.value), locale))}
        </p>
      )}
    </div>
  );
}

/**
 * A port, or for "range" a first and last port, with a protocol selector.
 * The form posts one "443/tcp" or "5060-5080/udp" string.
 */
export function PortControl({
  id,
  name,
  label,
  role,
  value,
  onChange,
  invalid,
  onPasteList,
}: {
  id: string;
  /** Omitted when a list posts the value instead. */
  name?: string;
  label: string;
  role: "port" | "range";
  value: string;
  onChange: (next: string) => void;
  invalid: boolean;
  /** In a list, a paste of several ports goes to the list. */
  onPasteList?: (entries: string[]) => void;
}) {
  const t = useMessages();
  const locale = useLocale();
  const net = t.editor.net;
  const initial = splitPortStored(value);
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [protocol, setProtocol] = useState(initial.protocol);

  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (value !== joinPortStored(start, end, protocol)) {
      const next = splitPortStored(value);
      setStart(next.start);
      setEnd(next.end);
      setProtocol(next.protocol);
    }
  }

  function update(a: string, b: string, p: string) {
    setStart(a);
    setEnd(b);
    setProtocol(p);
    onChange(joinPortStored(a, b, p));
  }

  /** "443/tcp", "tcp 443", "5060-5080/udp", or "https" fills every control. */
  function onPaste(event: ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData("text");
    if (onPasteList) {
      const entries = splitPortList(text);
      if (entries.length > 1) {
        event.preventDefault();
        onPasteList(entries);
        return;
      }
    }
    const parsed = parsePortSpec(text, role === "range");
    if (!parsed.ok) return;
    event.preventDefault();
    const spec = parsed.value;
    update(
      String(spec.start),
      spec.end === spec.start ? "" : String(spec.end),
      spec.protocol ?? protocol,
    );
  }

  const numberProps = {
    inputMode: "numeric" as const,
    autoComplete: "off",
    spellCheck: false,
    onPaste,
    "aria-invalid": invalid,
    className: "w-28 font-mono",
  };

  const parsed = parsePortSpec(joinPortStored(start, end, protocol), role === "range");
  let preview: string | null = null;
  if (parsed.ok) {
    const spec = parsed.value;
    const service = spec.start === spec.end ? serviceName(spec.start) : null;
    if (spec.start !== spec.end) {
      preview = net.portCount(formatCount(BigInt(portCount(spec)), locale));
    } else if (service) {
      preview = net.servicePreview(service);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      {name && <input type="hidden" name={name} value={joinPortStored(start, end, protocol)} />}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={id}
          aria-label={role === "range" ? net.portStart(label) : net.port(label)}
          value={start}
          placeholder={role === "range" ? "5060" : "443"}
          onChange={(event) => update(event.target.value, end, protocol)}
          {...numberProps}
        />
        {role === "range" && (
          <>
            <span aria-hidden className="text-[var(--muted-foreground)]">
              –
            </span>
            <Input
              aria-label={net.portEnd(label)}
              value={end}
              placeholder="5080"
              onChange={(event) => update(start, event.target.value, protocol)}
              {...numberProps}
            />
          </>
        )}
        <Select
          aria-label={net.protocol(label)}
          value={protocol}
          onChange={(event) => update(start, end, event.target.value)}
          aria-invalid={invalid}
          className={`${selectClass} w-36 shrink-0`}
        >
          <option value="">{net.anyProtocol}</option>
          {PROTOCOLS.map((p) => (
            <option key={p} value={p}>
              {net.protocols[p]}
            </option>
          ))}
        </Select>
      </div>
      <p className={hintClass} aria-live="polite">
        {preview ?? (role === "range" ? net.portRangeControlHint : net.portControlHint)}
      </p>
    </div>
  );
}

/**
 * An AS number. "AS" sits before the box, so a paste or a typed "AS13335"
 * (or asdot "1.10") is read down to the number.
 */
export function AsnControl({
  id,
  name,
  value,
  onChange,
  invalid,
}: {
  id: string;
  name: string;
  value: string;
  onChange: (next: string) => void;
  invalid: boolean;
}) {
  const t = useMessages();
  const parsed = parseAsn(value);
  const note = parsed.ok ? asnKind(parsed.value) : null;

  function absorb(text: string): boolean {
    const read = parseAsn(text);
    if (!read.ok || String(read.value) === text.trim()) return false;
    onChange(String(read.value));
    return true;
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span aria-hidden className="font-mono text-sm text-[var(--muted-foreground)]">
          AS
        </span>
        <Input
          id={id}
          name={name}
          value={value}
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          placeholder="13335"
          onChange={(event) => onChange(event.target.value)}
          onPaste={(event) => {
            if (absorb(event.clipboardData.getData("text"))) event.preventDefault();
          }}
          onBlur={() => absorb(value)}
          aria-invalid={invalid}
          className="w-40 font-mono"
        />
      </div>
      {note && <p className={hintClass}>{t.editor.net.asnNotes[note]}</p>}
    </div>
  );
}

/**
 * A MAC address, rewritten in the field's format the moment it holds a whole
 * address, so a paste of 78-45-58-8A-DC-95 reads 78:45:58:8a:dc:95 at once.
 */
export function MacControl({
  id,
  name,
  format,
  value,
  onChange,
  invalid,
}: {
  id: string;
  name: string;
  format: MacFormat;
  value: string;
  onChange: (next: string) => void;
  invalid: boolean;
}) {
  const t = useMessages();
  const complete = parseMac(value) !== null;

  return (
    <div className="flex flex-col gap-1">
      <Input
        id={id}
        name={name}
        value={value}
        autoComplete="off"
        spellCheck={false}
        placeholder={macFormatExample(format)}
        onChange={(event) => onChange(normalizeMac(event.target.value, format))}
        aria-invalid={invalid}
        className="font-mono"
      />
      {!complete && (
        <p className={hintClass}>{t.editor.net.macPreview(macFormatExample(format))}</p>
      )}
    </div>
  );
}
