"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ICONS, type NavItem } from "./Shell";

export function NavLinks({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav className="flex lg:flex-col overflow-x-auto lg:overflow-visible py-3">
      {items.map((it) => {
        const Icon = ICONS[it.icon];
        const active = path === it.href || path.startsWith(it.href + "/");
        return (
          <Link
            key={it.href}
            href={it.href}
            className={`nav-link flex items-center gap-3 px-6 h-11 border-l-2 transition-colors whitespace-nowrap ${
              active ? "border-rosso text-ink bg-elevated" : "border-transparent text-body hover:text-ink"
            }`}
          >
            <Icon size={16} strokeWidth={1.75} />
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
