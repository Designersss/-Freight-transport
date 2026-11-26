import { describe, expect, it } from "vitest";
import { defaultLocale, isLocale, locales, messages } from "./index";

describe("locales", () => {
  it("accepts only supported locale codes", () => {
    expect(locales.every(isLocale)).toBe(true);
    expect(isLocale("de")).toBe(false);
    expect(isLocale("RU")).toBe(false);
    expect(defaultLocale).toBe("ru");
  });

  it("provides the same message keys in both locales", () => {
    expect(Object.keys(messages.ru)).toEqual(Object.keys(messages.en));
    expect(Object.keys(messages.ru.common)).toEqual(
      Object.keys(messages.en.common),
    );
    expect(Object.keys(messages.ru.web)).toEqual(Object.keys(messages.en.web));
    expect(Object.keys(messages.ru.admin)).toEqual(
      Object.keys(messages.en.admin),
    );
  });
});
