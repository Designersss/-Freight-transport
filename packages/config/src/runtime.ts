export type RuntimeMode = "development" | "test" | "production";

/** Validates NODE_ENV at the application boundary without reading global state. */
export function parseRuntimeMode(value: unknown): RuntimeMode {
  if (value === "development" || value === "test" || value === "production") {
    return value;
  }

  throw new Error("NODE_ENV must be development, test, or production");
}
