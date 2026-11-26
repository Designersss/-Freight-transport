import { describe, expect, it } from "vitest";
import { parseTheme, toggleTheme } from "./theme";

describe("theme preference", () => {
  it("defaults to dark and rejects invalid values", () => {
    expect(parseTheme(undefined)).toBe("dark");
    expect(parseTheme("system")).toBe("dark");
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("light")).toBe("light");
  });

  it("toggles both themes", () => {
    expect(toggleTheme("dark")).toBe("light");
    expect(toggleTheme("light")).toBe("dark");
  });
});
