"use client";

import { type Locale, locales } from "@freight/i18n";
import { Moon, Sun } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "./components/button";
import { Link, usePathname } from "./navigation";
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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = Object.fromEntries(
    Array.from(new Set(searchParams.keys()), (key) => [
      key,
      searchParams.getAll(key),
    ]),
  );

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
        <Link className="movaro-wordmark" href="/">
          MOVARO
        </Link>
      ) : (
        <span aria-hidden="true" />
      )}
      <div className="movaro-controls">
        <nav aria-label={t("language")} className="movaro-language">
          {locales.map((language) => (
            <Link
              aria-current={language === locale ? "page" : undefined}
              href={{ pathname, query }}
              key={language}
              lang={language}
              locale={language}
            >
              {language.toUpperCase()}
            </Link>
          ))}
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
