"use client";

import type { ReactNode } from "react";
import { Link, usePathname } from "./navigation";

export interface NavigationItem {
  href: string;
  label: string;
  icon: ReactNode;
}

interface SidebarProps {
  brandHref: string;
  navigationLabel: string;
  items: readonly NavigationItem[];
}

export function Sidebar({ brandHref, navigationLabel, items }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="movaro-sidebar">
      <Link className="movaro-wordmark movaro-sidebar-brand" href={brandHref}>
        MOVARO
      </Link>
      <nav aria-label={navigationLabel} className="movaro-sidebar-nav">
        {items.map((item) => (
          <Link
            aria-current={pathname === item.href ? "page" : undefined}
            className="movaro-sidebar-link"
            href={item.href}
            key={item.href}
          >
            {item.icon}
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </aside>
  );
}
