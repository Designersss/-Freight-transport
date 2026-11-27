import { describe, expect, it } from "vitest";
import { formatDateInput, parseDateInput } from "./date-input";

describe("date-only input", () => {
  it("roundtrips localized and ISO dates without a time zone", () => {
    expect(parseDateInput("29.02.2000", "ru")).toBe("2000-02-29");
    expect(parseDateInput("02/29/2000", "en")).toBe("2000-02-29");
    expect(parseDateInput("2000-02-29", "ru")).toBe("2000-02-29");
    expect(formatDateInput("2000-02-29", "ru")).toBe("29.02.2000");
    expect(formatDateInput("2000-02-29", "en")).toBe("02/29/2000");
    expect(parseDateInput("01.01.0001", "ru")).toBe("0001-01-01");
  });

  it("rejects incomplete, impossible and ambiguous dates", () => {
    for (const value of [
      "",
      "29.02.",
      "29.02.1900",
      "31.04.2000",
      "00.01.2000",
      "01.13.2000",
      "01.01.0000",
      "2000-02-30",
      "2000-01-01T00:00:00Z",
    ]) {
      expect(parseDateInput(value, "ru")).toBeNull();
    }
    expect(parseDateInput("29/02/2000", "en")).toBeNull();
    expect(parseDateInput("02/29/2000", "ru")).toBeNull();
  });
});
