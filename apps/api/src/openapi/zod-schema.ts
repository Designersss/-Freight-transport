import type { SchemaObject } from "@nestjs/swagger";
import { z } from "zod";
import type { JSONSchema } from "zod/v4/core";

// Zod's OpenAPI 3.0 target uses the wider JSON Schema TypeScript model.
// Convert its nested schemas explicitly and fail on unsupported constructs.
function convert(raw: JSONSchema._JSONSchema): SchemaObject {
  if (typeof raw === "boolean")
    throw new Error("Unexpected boolean OpenAPI schema");
  const {
    properties,
    items,
    additionalProperties,
    anyOf,
    oneOf,
    allOf,
    not,
    exclusiveMinimum,
    exclusiveMaximum,
    ...scalar
  } = raw;
  if (
    raw.$ref ||
    raw.$defs ||
    raw.definitions ||
    raw.type === "null" ||
    Array.isArray(items) ||
    typeof exclusiveMinimum === "number" ||
    typeof exclusiveMaximum === "number"
  ) {
    throw new Error("Unsupported OpenAPI schema construct");
  }
  const schema: SchemaObject = { ...scalar };
  if (properties)
    schema.properties = Object.fromEntries(
      Object.entries(properties).map(([name, value]) => [name, convert(value)]),
    );
  if (items !== undefined) schema.items = convert(items);
  if (additionalProperties !== undefined)
    schema.additionalProperties =
      typeof additionalProperties === "boolean"
        ? additionalProperties
        : convert(additionalProperties);
  if (anyOf) schema.anyOf = anyOf.map(convert);
  if (oneOf) schema.oneOf = oneOf.map(convert);
  if (allOf) schema.allOf = allOf.map(convert);
  if (not !== undefined) schema.not = convert(not);
  if (exclusiveMinimum !== undefined) schema.exclusiveMinimum = exclusiveMinimum;
  if (exclusiveMaximum !== undefined) schema.exclusiveMaximum = exclusiveMaximum;
  return schema;
}

export function openApiSchema(schema: z.ZodType): SchemaObject {
  // Input mode retains email/username string validation before transforms.
  // Response DTOs use the same public wire shape; runtime refinements (UTC
  // date bounds, reserved names, role-dependent company) remain server-side.
  return convert(z.toJSONSchema(schema, { target: "openapi-3.0", io: "input" }));
}
