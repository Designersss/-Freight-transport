import { defineRouting } from "next-intl/routing";
import { defaultLocale, locales } from "./index";

export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: "always",
  localeDetection: false,
});
