import "../globals.css";

import { isLocale, messages } from "@freight/i18n";
import {
  Header,
  parseTheme,
  SkipLink,
  themeCookie,
  UiProvider,
} from "@freight/ui";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "MOVARO",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "MOVARO",
    statusBarStyle: "default",
  },
  icons: {
    icon: [{ url: "/pwa/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [
      { url: "/pwa/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

interface LayoutProps {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function RootLayout({ children, params }: LayoutProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const theme = parseTheme((await cookies()).get(themeCookie)?.value);

  return (
    <html data-theme={theme} lang={locale}>
      <body>
        <UiProvider locale={locale}>
          <SkipLink label={messages[locale].common.skip} />
          <Header initialTheme={theme} locale={locale} />
          {children}
        </UiProvider>
      </body>
    </html>
  );
}
