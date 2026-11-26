"use client";

import type { Locale } from "@freight/i18n";
import { Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "./components/button";
import { type Theme, themeCookie, toggleTheme } from "./theme";

interface HeaderProps {
  locale: Locale;
  initialTheme: Theme;
  showBrand?: boolean;
}

export function Header({
  locale,
  initialTheme,
  showBrand = true,
}: HeaderProps) {
  const t = useTranslations("common");
  const [theme, setTheme] = useState(initialTheme);

  function changeTheme() {
    const next = toggleTheme(theme);
    document.documentElement.dataset.theme = next;
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    // biome-ignore lint/suspicious/noDocumentCookie: one non-sensitive preference, compatible with browsers without Cookie Store API.
    document.cookie = `${themeCookie}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
    setTheme(next);
  }

  return (
    <header className="movaro-header">
      {showBrand ? (
        <a className="movaro-wordmark" href={`/${locale}`}>
          MOVARO
        </a>
      ) : (
        <span aria-hidden="true" />
      )}
      <div className="movaro-controls">
        <nav aria-label={t("language")} className="movaro-language">
          <a
            aria-current={locale === "ru" ? "page" : undefined}
            href="/ru"
            lang="ru"
          >
            RU
          </a>
          <a
            aria-current={locale === "en" ? "page" : undefined}
            href="/en"
            lang="en"
          >
            EN
          </a>
        </nav>
        <Button
          aria-label={t("theme")}
          aria-pressed={theme === "light"}
          variant="outline"
          size="icon"
          onClick={changeTheme}
          type="button"
        >
          {theme === "dark" ? (
            <Moon aria-hidden="true" size={16} />
          ) : (
            <Sun aria-hidden="true" size={16} />
          )}
        </Button>
      </div>
    </header>
  );
}
