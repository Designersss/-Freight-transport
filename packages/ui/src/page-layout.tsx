import type { ReactNode } from "react";

interface PageLayoutProps {
  children: ReactNode;
  title: string;
}

export function PageLayout({ children, title }: PageLayoutProps) {
  return (
    <main className="movaro-main" id="main-content">
      <h1 className="movaro-heading">{title}</h1>
      {children}
    </main>
  );
}
