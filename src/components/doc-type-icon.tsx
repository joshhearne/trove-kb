import { createElement } from "react";
import { FileText, icons, type LucideProps } from "lucide-react";
import { iconLookup } from "@/lib/icon-name";

type IconComponent = React.ComponentType<LucideProps>;

/** Every icon lucide-react ships, found by either spelling of its name. */
const lookup = iconLookup<IconComponent>(Object.entries(icons));

/** The component for a stored icon name, or null when lucide has no such icon. */
export function resolveIcon(name: string | null | undefined): IconComponent | null {
  if (!name) return null;
  return lookup(name) ?? null;
}

/**
 * A doc type's icon, beside its name wherever the name appears. A type without
 * one, or with a name lucide no longer knows, shows a plain document so the
 * row keeps its shape.
 */
export function DocTypeIcon({
  name,
  className,
}: {
  name: string | null | undefined;
  className?: string;
}) {
  // The map holds one stable component per name; chosen here, not made here.
  return createElement(resolveIcon(name) ?? FileText, { className, "aria-hidden": true });
}
