"use client";

import type { RenderedValue } from "@/server/fields/render";
import { useMessages } from "@/i18n/client";

type IpValue = Extract<RenderedValue, { kind: "ip" }>;
type RangeValue = Extract<RenderedValue, { kind: "range" }>;
type MacValue = Extract<RenderedValue, { kind: "mac" }>;
type PortValue = Extract<RenderedValue, { kind: "port" }>;

const badgeClass =
  "rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]";

/**
 * An IP address or a network, badged so the two never read alike: an address
 * is one host (shown without its /32), a network is a block. Either one with
 * a block opens to show it worked out.
 */
export function IpValueView({ value }: { value: IpValue }) {
  const t = useMessages();
  const net = t.editor.net;
  const isNetwork = value.role === "network";
  const single = value.block === null;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className={badgeClass}>{isNetwork ? net.badgeNetwork : net.badgeAddress}</span>
        <span className="font-mono text-sm">
          {value.address}
          {!single && <span className="text-[var(--muted-foreground)]">/{value.prefix}</span>}
        </span>
        {!isNetwork && value.block && value.addressKind === "host_in_network" && (
          <span className="text-xs text-[var(--muted-foreground)]">
            {net.onNetwork(value.block.network)}
          </span>
        )}
      </div>
      {!isNetwork && value.addressKind === "network_address" && (
        <p className="text-xs text-[var(--muted-foreground)]">{net.networkAddressNote}</p>
      )}
      {value.block && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-[var(--muted-foreground)]">
            {net.blockDetails}
          </summary>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
            <Row term={net.blockNetwork} detail={value.block.network} />
            {value.block.mask && <Row term={net.blockMask} detail={value.block.mask} />}
            {value.block.wildcard && <Row term={net.blockWildcard} detail={value.block.wildcard} />}
            {value.block.broadcast && (
              <Row term={net.blockBroadcast} detail={value.block.broadcast} />
            )}
            <Row
              term={net.blockUsableRange}
              detail={`${value.block.firstUsable} – ${value.block.lastUsable}`}
            />
            <Row term={net.blockUsable} detail={value.block.usable} />
            <Row term={net.blockTotal} detail={value.block.total} />
          </dl>
        </details>
      )}
    </div>
  );
}

function Row({ term, detail }: { term: string; detail: string }) {
  return (
    <>
      <dt className="text-[var(--muted-foreground)]">{term}</dt>
      <dd className="min-w-0 break-all font-mono">{detail}</dd>
    </>
  );
}

export function IpRangeView({ value }: { value: RangeValue }) {
  const t = useMessages();
  return (
    <span className="flex flex-wrap items-baseline gap-2">
      <span className="font-mono text-sm">
        {value.start} – {value.end}
      </span>
      <span className="text-xs text-[var(--muted-foreground)]">
        {t.editor.net.rangeSize(value.size)}
      </span>
    </span>
  );
}

export function MacValueView({ value }: { value: MacValue }) {
  const t = useMessages();
  return (
    <span className="flex flex-col gap-1">
      <span className="font-mono text-sm">{value.text}</span>
      {value.locallyAdministered && (
        <span className="text-xs text-[var(--muted-foreground)]">
          {t.editor.net.locallyAdministered}
        </span>
      )}
    </span>
  );
}

/** A port or a range, its protocol badged, with the service or the count. */
export function PortValueView({ value }: { value: PortValue }) {
  const t = useMessages();
  const net = t.editor.net;
  return (
    <span className="flex flex-wrap items-baseline gap-2">
      <span className="font-mono text-sm">{value.ports}</span>
      {value.protocol && <span className={badgeClass}>{net.protocols[value.protocol]}</span>}
      {value.service ? (
        <span className="text-xs text-[var(--muted-foreground)]">{value.service}</span>
      ) : (
        value.count && (
          <span className="text-xs text-[var(--muted-foreground)]">{net.portCount(value.count)}</span>
        )
      )}
    </span>
  );
}
