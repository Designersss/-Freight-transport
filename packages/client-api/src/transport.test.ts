import { describe, expect, it, vi } from "vitest";
import { createApiFetch } from "./transport.js";

describe("API transport", () => {
  it("resolves a versioned API path against the request-specific origin", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    const apiFetch = createApiFetch("http://127.0.0.1:4000", fetcher);
    const options = { method: "GET", headers: { "x-test": "value" } };
    await apiFetch("/api/v1/health", options);
    expect(fetcher).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:4000/api/v1/health"),
      { ...options, redirect: "error" },
    );
  });

  it("does not allow callers to follow redirects outside the API boundary", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
    await createApiFetch("https://example.com", fetcher)("/api/v1/health", {
      redirect: "follow",
    });
    expect(fetcher).toHaveBeenCalledWith(
      new URL("https://example.com/api/v1/health"),
      { redirect: "error" },
    );
  });

  it.each([
    "ftp://example.com",
    "https://example.com/path",
    "https://user@example.com",
  ])("rejects invalid API origin %s", (origin) => {
    expect(() => createApiFetch(origin)).toThrow("API origin");
  });

  it.each([
    "https://example.com",
    "//example.com/api/v1/health",
    "/api/v1/../../outside",
  ])("rejects invalid API path %s", (path) => {
    expect(() => createApiFetch("http://127.0.0.1:4000")(path)).toThrow();
  });
});
