import { defineConfig } from "orval";

export default defineConfig({
  freight: {
    input: {
      target: "./openapi.json",
      // Browser redirects and binary photo transfers use their existing
      // dedicated transport rather than the JSON fetch client.
      filters: { mode: "exclude", tags: ["AuthBrowser"] },
    },
    output: {
      target: "./src/generated/api.ts",
      mode: "single",
      client: "fetch",
      mock: false,
      override: {
        fetch: {
          useRuntimeFetcher: true,
          includeHttpResponseReturnType: true,
        },
      },
    },
  },
});
