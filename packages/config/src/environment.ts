import { z } from "zod";

export const serverEnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  DATABASE_URL: z
    .url()
    .refine(
      (value) =>
        URL.canParse(value) &&
        ["postgres:", "postgresql:"].includes(new URL(value).protocol),
      "Expected PostgreSQL URL",
    ),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
});

export function parseEnvironment<T extends z.ZodType>(
  schema: T,
  env: Record<string, unknown>,
  service: string,
): z.output<T> {
  const result = schema.safeParse(env);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join("."));
    throw new Error(`Invalid ${service} environment: ${fields.join(", ")}`);
  }
  return result.data;
}
