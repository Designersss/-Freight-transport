import { describe, expect, it } from "vitest";
import { z } from "zod";
import { openApiSchema } from "./zod-schema.js";

describe("OpenAPI 3.0 schema conversion", () => {
  it("preserves nested types, nullable values and optional input fields", () => {
    const schema = openApiSchema(
      z.strictObject({
        name: z.string().nullable(),
        values: z.array(z.number()),
        note: z.string().optional(),
      }),
    );

    expect(schema).toMatchObject({
      type: "object",
      required: ["name", "values"],
      additionalProperties: false,
      properties: {
        name: { type: "string", nullable: true },
        values: { type: "array", items: { type: "number" } },
        note: { type: "string" },
      },
    });
  });
});
