/** A request-scoped transport for server clients; browser clients can use same-origin fetch. */
export function createApiFetch(
  origin: string,
  fetcher: typeof fetch = globalThis.fetch,
): typeof fetch {
  const base = new URL(origin);
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.pathname !== "/" ||
    base.search ||
    base.hash
  ) {
    throw new Error("API origin must be an HTTP(S) origin without credentials");
  }
  return (input, options) => {
    if (typeof input !== "string" || !input.startsWith("/api/v1/")) {
      throw new Error("Expected a relative versioned API path");
    }
    const target = new URL(input, base);
    if (
      target.origin !== base.origin ||
      !target.pathname.startsWith("/api/v1/")
    ) {
      throw new Error("API path escapes the configured origin or prefix");
    }
    return fetcher(target, options);
  };
}
