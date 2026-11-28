import "../globals.css";

import { adminPreviewAllowed } from "@freight/auth/proxy-ip";
import { isLocale, messages } from "@freight/i18n";
import { parseTheme, SkipLink, themeCookie, UiProvider } from "@freight/ui";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "MOVARO",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

interface LayoutProps {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function RootLayout({ children, params }: LayoutProps) {
  if (!adminPreviewAllowed(await headers(), process.env)) notFound();
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const theme = parseTheme((await cookies()).get(themeCookie)?.value);

  return (
    <html data-theme={theme} lang={locale}>
      <body>
        <UiProvider locale={locale}>
          <SkipLink label={messages[locale].common.skip} />
          {children}
        </UiProvider>
      </body>
    </html>
  );
}
