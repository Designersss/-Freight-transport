export const themeCookie = "movaro-theme";
export type Theme = "dark" | "light";

export function parseTheme(value: string | undefined): Theme {
  return value === "light" ? "light" : "dark";
}

export function toggleTheme(theme: Theme): Theme {
  return theme === "dark" ? "light" : "dark";
}
