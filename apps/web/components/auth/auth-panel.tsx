import { Card, CardContent, CardHeader } from "@freight/ui";
import type { ReactNode } from "react";

export function AuthPanel({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <main id="main-content" tabIndex={-1} className="mx-auto flex min-h-[calc(100dvh-60px)] w-full max-w-[440px] items-center px-4 py-10 sm:px-6">
      <Card className="w-full gap-6 rounded-2xl py-7 shadow-sm">
        <CardHeader className="gap-2 px-6 sm:px-8">
          <h1 className="text-[23px] font-bold leading-tight tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </CardHeader>
        <CardContent className="px-6 sm:px-8">{children}</CardContent>
      </Card>
    </main>
  );
}
