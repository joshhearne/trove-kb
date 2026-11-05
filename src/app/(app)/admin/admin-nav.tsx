"use client";

import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import {
  Activity,
  Bell,
  BookOpen,
  Globe,
  IdCard,
  KeyRound,
  Layers,
  ListTree,
  Palette,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
  Webhook,
} from "lucide-react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMessages } from "@/i18n/client";

/**
 * The secondary rail. On a phone there is no room beside the content, so it
 * folds down to the section being read and opens on a tap — vertical either
 * way, because a sideways-scrolling row hides the sections nobody scrolls to.
 */
export function AdminNav() {
  const pathname = usePathname();
  const t = useMessages();
  const [open, setOpen] = useState(false);

  const sections: { href: Route; label: string; icon: typeof Users }[] = [
    { href: "/admin/users" as Route, label: t.nav.users, icon: Users },
    { href: "/admin/roles" as Route, label: t.nav.roles, icon: IdCard },
    { href: "/admin/settings" as Route, label: t.nav.settings, icon: Settings },
    { href: "/admin/branding" as Route, label: t.nav.branding, icon: Palette },
    {
      href: "/admin/option-lists" as Route,
      label: t.nav.optionLists,
      icon: ListTree,
    },
    { href: "/admin/doc-types" as Route, label: t.nav.docTypes, icon: Layers },
    {
      href: "/admin/notifications" as Route,
      label: t.nav.notifications,
      icon: Bell,
    },
    { href: "/admin/webhooks" as Route, label: t.nav.webhooks, icon: Webhook },
    { href: "/admin/api-keys" as Route, label: t.nav.apiKeys, icon: KeyRound },
    { href: "/admin/kb" as Route, label: t.nav.knowledgeBase, icon: BookOpen },
    { href: "/admin/portal" as Route, label: t.nav.portal, icon: Globe },
    { href: "/admin/vault" as Route, label: t.nav.vault, icon: ShieldCheck },
    { href: "/admin/audit" as Route, label: t.nav.auditLog, icon: ScrollText },
    { href: "/admin/system" as Route, label: t.nav.system, icon: Activity },
  ];

  const current = sections.find((section) => pathname.startsWith(section.href));

  return (
    <nav aria-label={t.nav.admin} className="md:w-56 md:shrink-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="admin-sections"
        className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm md:hidden"
      >
        <span className="font-medium">{current?.label ?? t.nav.admin}</span>
        <ChevronDown
          aria-hidden
          className={cn("size-4 transition-transform", open && "rotate-180")}
        />
      </button>

      <ul
        id="admin-sections"
        className={cn(
          "mt-1 flex-col gap-1 md:mt-0 md:flex",
          open ? "flex" : "hidden",
        )}
      >
        {sections.map((section) => {
          const active = pathname.startsWith(section.href);
          const Icon = section.icon;

          return (
            <li key={section.href}>
              <Link
                href={section.href}
                aria-current={active ? "page" : undefined}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-[var(--primary)] font-medium text-[var(--primary-foreground)]"
                    : "text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                {section.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
