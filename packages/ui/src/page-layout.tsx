import type { ReactNode } from "react";

interface PageLayoutProps {
  children: ReactNode;
  title: string;
}

export function PageLayout({ children, title }: PageLayoutProps) {
  return (
    <main className="movaro-main" id="main-content" tabIndex={-1}>
      <h1 className="movaro-heading">{title}</h1>
      {children}
    </main>
  );
}
