import { defineConfig } from "orval";

export default defineConfig({
  freight: {
    input: "./openapi.json",
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
