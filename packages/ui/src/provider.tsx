"use client";

import { type Locale, messages } from "@freight/i18n";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";

interface UiProviderProps {
  children: ReactNode;
  locale: Locale;
}

export function UiProvider({ children, locale }: UiProviderProps) {
  return (
    <NextIntlClientProvider locale={locale} messages={messages[locale]} timeZone="UTC">
      {children}
    </NextIntlClientProvider>
  );
}
