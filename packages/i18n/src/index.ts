export const locales = ["ru", "en"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "ru";

export function isLocale(value: string): value is Locale {
  return locales.some((locale) => locale === value);
}

const ru = {
  common: {
    theme: "Светлая тема",
    language: "Язык",
    skip: "Перейти к содержимому",
  },
  web: {
    title: "Управление арендой техники",
    description: "MOVARO — платформа для управления бизнесом по сдаче техники в аренду.",
  },
  admin: {
    title: "Администрирование",
  },
};

const en: typeof ru = {
  common: {
    theme: "Light theme",
    language: "Language",
    skip: "Skip to content",
  },
  web: {
    title: "Equipment rental management",
    description: "MOVARO is a platform for managing an equipment rental business.",
  },
  admin: {
    title: "Administration",
  },
};

export const messages = { ru, en } satisfies Record<Locale, typeof ru>;
