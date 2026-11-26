"use client";

import type { Locale } from "@freight/i18n";
import { Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { type Theme, themeCookie, toggleTheme } from "./theme";

interface HeaderProps {
  locale: Locale;
  initialTheme: Theme;
}

export function Header({ locale, initialTheme }: HeaderProps) {
  const t = useTranslations("common");
  const [theme, setTheme] = useState(initialTheme);

  function changeTheme() {
    const next = toggleTheme(theme);
    document.documentElement.dataset.theme = next;
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${themeCookie}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
    setTheme(next);
  }

  return (
    <header className="movaro-header">
      <a className="movaro-wordmark" href={`/${locale}`}>
        MOVARO
      </a>
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
        <button
          aria-label={t("theme")}
          aria-pressed={theme === "light"}
          className="movaro-icon-button"
          onClick={changeTheme}
          type="button"
        >
          {theme === "dark" ? (
            <Moon aria-hidden="true" size={16} />
          ) : (
            <Sun aria-hidden="true" size={16} />
          )}
        </button>
      </div>
    </header>
  );
}
