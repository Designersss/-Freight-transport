import { describe, expect, it } from "vitest";
import { cn } from "./lib/utils";

describe("cn", () => {
  it("merges conflicting Tailwind utilities", () => {
    expect(cn("px-2", false, "px-4")).toBe("px-4");
  });

  it("preserves independent conditional classes", () => {
    expect(cn("flex", { hidden: false, "gap-2": true })).toBe("flex gap-2");
  });
});
