import { describe, expect, it } from "vitest";
import { createApiFetch, getLiveness, getReadiness } from "./index.js";

describe("Generated client against real API", () => {
  const origin = process.env.TEST_API_ORIGIN;
  if (!origin) throw new Error("TEST_API_ORIGIN is required");
  const apiFetch = createApiFetch(origin);

  it("calls the liveness endpoint", async () => {
    const result = await getLiveness(undefined, apiFetch);
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ status: "ok" });
  });

  it("calls the readiness endpoint on a migrated PostgreSQL database", async () => {
    const result = await getReadiness(undefined, apiFetch);
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ status: "ready" });
  });
});
