import Link from "next/link";
import type { RenderedValue } from "@/server/fields/render";
import {
  AsnValueView,
  IpRangeView,
  IpValueView,
  MacValueView,
  PortValueView,
} from "@/components/fields/network-value";

/** Read-only rendering of one already-resolved field value. */
export function FieldValue({ value }: { value: RenderedValue }) {
  switch (value.kind) {
    case "empty":
      return <span className="text-sm text-[var(--muted-foreground)]">—</span>;

    case "text":
      return <span className="text-sm whitespace-pre-wrap">{value.text}</span>;

    case "code":
      return <span className="font-mono text-sm">{value.text}</span>;

    case "ip":
      return <IpValueView value={value} />;

    case "ip_list":
      return (
        <ol className="flex flex-col gap-2">
          {value.items.map((item, index) => (
            <li key={index}>
              {item.kind === "ip" ? (
                <IpValueView value={item} />
              ) : (
                <span className="text-sm">{item.text}</span>
              )}
            </li>
          ))}
        </ol>
      );

    case "range":
      return <IpRangeView value={value} />;

    case "mac":
      return <MacValueView value={value} />;

    case "port":
      return <PortValueView value={value} />;

    case "asn":
      return <AsnValueView value={value} />;

    case "port_list":
      return (
        <ul className="flex flex-col gap-1">
          {value.items.map((item, index) => (
            <li key={index}>
              {item.kind === "port" ? (
                <PortValueView value={item} />
              ) : (
                <span className="text-sm">{item.text}</span>
              )}
            </li>
          ))}
        </ul>
      );

    case "url":
      return (
        <a
          href={value.href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="text-sm underline"
        >
          {value.href}
        </a>
      );

    case "tags":
      return (
        <span className="flex flex-wrap gap-1">
          {value.labels.map((label) => (
            <span key={label} className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-xs">
              {label}
            </span>
          ))}
        </span>
      );

    case "document":
      return (
        <Link href={`/documents/${value.id}`} className="text-sm underline">
          {value.title}
        </Link>
      );

    case "secret":
      // The document page renders this with SecretField, which brokers the
      // reveal. Reaching here means no vault context was supplied.
      return <span className="text-sm text-[var(--muted-foreground)]">{value.label}</span>;

    case "html":
      // Sanitized on write and again on read in renderFieldValue.
      return <div className="prose-editor text-sm" dangerouslySetInnerHTML={{ __html: value.html }} />;
  }
}
