import type { ReactNode } from "react";

interface AppShellProps {
  sidebar: ReactNode;
  header: ReactNode;
  children: ReactNode;
}

export function AppShell({ sidebar, header, children }: AppShellProps) {
  return (
    <div className="movaro-shell">
      {sidebar}
      <div className="movaro-shell-content">
        {header}
        {children}
      </div>
    </div>
  );
}
