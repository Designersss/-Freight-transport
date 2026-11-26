import type { ReactNode } from "react";

export interface NavigationItem {
  href: string;
  label: string;
  icon: ReactNode;
  active?: boolean;
}

interface SidebarProps {
  brandHref: string;
  navigationLabel: string;
  items: readonly NavigationItem[];
}

export function Sidebar({ brandHref, navigationLabel, items }: SidebarProps) {
  return (
    <aside className="movaro-sidebar">
      <a className="movaro-wordmark movaro-sidebar-brand" href={brandHref}>
        MOVARO
      </a>
      <nav aria-label={navigationLabel} className="movaro-sidebar-nav">
        {items.map((item) => (
          <a
            aria-current={item.active ? "page" : undefined}
            className="movaro-sidebar-link"
            href={item.href}
            key={item.href}
          >
            {item.icon}
            <span>{item.label}</span>
          </a>
        ))}
      </nav>
    </aside>
  );
}
